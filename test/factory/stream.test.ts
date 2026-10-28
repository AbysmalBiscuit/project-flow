import { describe, expect, test } from "bun:test";

import hubEvents from "../fixtures/factory-hub-events.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import { type Answers, EventFeed, hub, hubUrl } from "../support/factory.ts";
import { openEventStream } from "../support/reads.ts";
import {
	factoryRunOf,
	hubWith41,
	overviewEventWhere,
	overviewWhere,
	progressAt,
	reportOf,
	reportTicket,
	runPollMs,
	serveRuns,
} from "./_support.ts";

const streamRetryMs = 10_000;

const streamedRunPollMs = 60_000;

describe("factory runs", () => {
	describe("the hub event stream", () => {
		test("stage frames update the run stage and reach /api/events with no run poll request", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41], {
				41: progressAt("2026-10-25T14:10:00Z"),
			});
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				// The first run poll and the connect snapshot each read /runs.
				while (app.runReads() < 2) {
					await Bun.sleep(10);
				}
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				const reads = app.runReads();
				const [planStarted, planCompleted, buildStarted] = hubEvents;
				feed.send(planStarted);
				const planning = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "plan",
				);
				expect(factoryRunOf(planning, 41)).toMatchObject({
					statusKind: "running",
					stage: "plan",
				});
				feed.send(planCompleted);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === undefined,
				);
				feed.send(buildStarted);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.stage === "build",
				);
				expect(reportTicket(await reportOf(app.base), 41).run).toEqual({
					status: "running",
					stage: "build",
				});
				expect(app.runReads()).toBe(reads);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a closed stream waits, then reconnects and reads a fresh /runs snapshot", async () => {
			const feed = new EventFeed();
			const app = await serveRuns({ ...hub, "/events": feed }, [41]);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				// The first run poll and the connect snapshot each read /runs.
				while (app.runReads() < 2) {
					await Bun.sleep(10);
				}
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				const reads = app.runReads();
				app.factories[hubUrl] = { ...hubWith41("blocked"), "/events": feed };
				app.advance(streamRetryMs / 2);
				feed.drop();
				// One turn of the event loop lets the app see the close at this clock time.
				await Bun.sleep(0);
				app.advance(streamRetryMs / 2);
				// The run poll reads /runs of the hub only once its stream is closed.
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "blocked",
				);
				expect(app.runReads()).toBe(reads + 1);
				expect(app.eventReads()).toBe(1);
				app.factories[hubUrl] = { ...hubWith41("running"), "/events": feed };
				app.advance(streamRetryMs / 2);
				await feed.connected(2);
				const changed = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				expect(factoryRunOf(changed, 41)?.coveredByFeed).toBe(true);
				expect(app.eventReads()).toBe(2);
				expect(app.runReads()).toBe(reads + 2);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("an open stream keeps a slow /runs read that shows a run the hub queues", async () => {
			const feed = new EventFeed();
			const [running41, , queued42] = hubRuns.runs;
			const app = await serveRuns(
				{ ...hub, "/runs": { runs: [running41] }, "/events": feed },
				[41, 42],
			);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				app.factories[hubUrl] = {
					...hub,
					"/runs": { runs: [running41, queued42] },
					"/events": feed,
				};
				app.advance(streamedRunPollMs);
				const changed = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42) !== undefined,
				);
				expect(factoryRunOf(changed, 42)).toMatchObject({
					statusKind: "queued",
					coveredByFeed: true,
				});
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a streamed run gets its start time and its end time from the slow /runs read", async () => {
			const feed = new EventFeed();
			const [, , queued42] = hubRuns.runs;
			if (queued42 === undefined) {
				throw new Error("the hub runs fixture lost a run");
			}
			const hubWith42 = (row: Record<string, unknown>): Answers => ({
				...hub,
				"/runs": { runs: [{ ...queued42, ...row }] },
				"/events": feed,
			});
			const app = await serveRuns(hubWith42({}), [42]);
			const stream = openEventStream(app.base);
			try {
				await feed.connected(1);
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 42)?.statusKind === "queued",
				);
				await stream.ready;
				const startedAt = "2026-10-25T14:16:00+00:00";
				app.factories[hubUrl] = hubWith42({
					status: { kind: "running", reason: null },
					started_at: startedAt,
					machine: "box-a",
				});
				feed.send({ run_id: queued42.id, status: { kind: "running" } });
				app.advance(streamedRunPollMs);
				const started = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42)?.startedAt === startedAt,
				);
				expect(factoryRunOf(started, 42)).toMatchObject({
					statusKind: "running",
					endedAt: null,
				});
				const endedAt = "2026-10-25T14:40:00+00:00";
				app.factories[hubUrl] = hubWith42({
					status: { kind: "succeeded", reason: null },
					started_at: startedAt,
					ended_at: endedAt,
					machine: "box-a",
				});
				feed.send({ run_id: queued42.id, status: { kind: "succeeded" } });
				app.advance(streamedRunPollMs);
				const ended = await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 42)?.endedAt === endedAt,
				);
				expect(factoryRunOf(ended, 42)).toMatchObject({
					statusKind: "succeeded",
					startedAt,
				});
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});

		test("a factory that answers 404 on /events keeps the run poll", async () => {
			const app = await serveRuns(hub, [41]);
			const stream = openEventStream(app.base);
			try {
				await overviewWhere(
					app.base,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
				);
				await stream.ready;
				while (app.eventReads() === 0) {
					await Bun.sleep(10);
				}
				const reads = app.runReads();
				app.factories[hubUrl] = hubWith41("blocked");
				app.advance(runPollMs);
				await overviewEventWhere(
					stream.events,
					(seen) => factoryRunOf(seen, 41)?.statusKind === "blocked",
				);
				expect(app.runReads()).toBe(reads + 1);
				expect(app.eventReads()).toBe(1);
			} finally {
				stream.close();
				await app.stop();
			}
		});
	});
});
