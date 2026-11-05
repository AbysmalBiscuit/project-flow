import { describe, expect, test } from "bun:test";

import hubEvents from "../fixtures/factory-hub-events.json";
import holds from "../fixtures/factory-hub-holds.json";
import queueSources from "../fixtures/factory-hub-queue-sources.json";
import machine from "../fixtures/factory-machine.json";
import runQuestions from "../fixtures/factory-run-questions.json";
import { type Answers, EventFeed, laptopSocket } from "../support/factory.ts";
import { openEventStream } from "../support/reads.ts";
import {
	clockStart,
	factoriesWhere,
	hubAbout,
	hubRun,
	laptopAbout,
	serveFactories,
	usage,
} from "./_support.ts";

const running41 = hubRun({
	id: "run-41",
	started_at: "2026-10-25T14:01:10+00:00",
	usage: usage(1.5),
});
const running43 = hubRun({
	id: "run-43",
	ticket: "43",
	machine: "box-b",
	started_at: "2026-10-25T13:30:00+00:00",
	usage: usage(2),
});
const merged40 = hubRun({
	id: "run-40",
	ticket: "40",
	status: { kind: "succeeded", reason: null },
	started_at: "2026-10-25T13:05:20+00:00",
	ended_at: "2026-10-25T13:48:02+00:00",
	usage: usage(4),
});
const failed39 = hubRun({
	id: "run-39",
	ticket: "39",
	status: { kind: "failed", reason: "stage review failed" },
	started_at: "2026-10-25T12:00:09+00:00",
	ended_at: "2026-10-25T12:30:00+00:00",
	usage: usage(2),
});
const restartedFailed38 = hubRun({
	id: "run-38",
	ticket: "38",
	status: { kind: "failed", reason: "limit_reached" },
	started_at: "2026-10-25T12:10:00+00:00",
	ended_at: "2026-10-25T13:00:00+00:00",
	usage: usage(1),
});
const blocked38 = hubRun({
	id: "run-38-again",
	ticket: "38",
	status: { kind: "blocked", reason: null },
	started_at: "2026-10-25T13:10:00+00:00",
	restarted_from: "run-38",
	usage: usage(0.5),
});
const failedYesterday37 = hubRun({
	id: "run-37",
	ticket: "37",
	status: { kind: "failed", reason: "network" },
	started_at: "2026-10-24T12:00:00+00:00",
	ended_at: "2026-10-24T13:00:00+00:00",
	usage: usage(3),
});
const laptop50 = hubRun({
	id: "run-50",
	ticket: "50",
	machine: "local",
	source: null,
	rule: null,
	started_at: "2026-10-25T13:00:00+00:00",
	usage: usage(0.25),
});

const hubAnswers: Answers = {
	"/daemon": hubAbout,
	"/sources": { sources: [] },
	"/runs": {
		runs: [
			running41,
			running43,
			merged40,
			failed39,
			restartedFailed38,
			blocked38,
			failedYesterday37,
		],
	},
	"/runs/run-40": {
		...merged40,
		outputs: { merge_sha: "4f1c2a9e" },
		pr: {
			owner: "acme",
			repo: "widget",
			number: 72,
			url: "https://github.com/acme/widget/pull/72",
		},
	},
	"/runs/run-38-again/questions": runQuestions,
};

const laptopAnswers: Answers = {
	"/daemon": laptopAbout,
	"/runs": { runs: [laptop50] },
};

describe("the Factories tab", () => {
	test("two factories give the tiles, the box cards and the running runs, longest first", async () => {
		const app = await serveFactories(hubAnswers, laptopAnswers);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					seen.tiles.merged.last === 1 &&
					seen.running.length === 4 &&
					seen.attention.length === 2,
			);
			expect(page.tiles).toEqual({
				running: 4,
				slots: { total: 14, used: 4 },
				queued: 0,
				longestWaitSince: null,
				attention: { total: 2, failed: 1, stalled: 0, asks: 1 },
				merged: { last: 1, before: 0 },
				failed: {
					last: 2,
					before: 1,
					reasons: [
						{ reason: "limit_reached", count: 1 },
						{ reason: "stage review failed", count: 1 },
					],
				},
				cost: { last: 7, perMerged: 7 },
			});
			expect(page.boxes).toEqual([
				{
					name: "work hub",
					role: "hub",
					reachable: true,
					slots: { total: 12, used: 3 },
					heartbeatAt: clockStart,
				},
				{
					name: "laptop",
					role: "daemon",
					reachable: true,
					slots: { total: 2, used: 1 },
					heartbeatAt: clockStart,
				},
			]);
			expect(
				page.running.map(({ id, key, factory, startedAt, costUsd }) => ({
					id,
					key,
					factory,
					startedAt,
					costUsd,
				})),
			).toEqual([
				{
					id: "run-50",
					key: "acme/widget#50",
					factory: "laptop",
					startedAt: "2026-10-25T13:00:00+00:00",
					costUsd: 0.25,
				},
				{
					id: "run-38-again",
					key: "acme/widget#38",
					factory: "work hub",
					startedAt: "2026-10-25T13:10:00+00:00",
					costUsd: 0.5,
				},
				{
					id: "run-43",
					key: "acme/widget#43",
					factory: "work hub",
					startedAt: "2026-10-25T13:30:00+00:00",
					costUsd: 2,
				},
				{
					id: "run-41",
					key: "acme/widget#41",
					factory: "work hub",
					startedAt: "2026-10-25T14:01:10+00:00",
					costUsd: 1.5,
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("needs attention lists a failed run with no restart and an open ask, and not a restarted failed run", async () => {
		const app = await serveFactories(hubAnswers);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) => seen.attention.length === 2,
			);
			expect(page.attention).toEqual([
				{
					kind: "ask",
					runId: "run-38-again",
					key: "acme/widget#38",
					factory: "work hub",
					reason:
						"This waits on Lev: the change needs the `read:org` scope on the factory token. Should the run add the scope, or drop the org check?",
					since: clockStart,
				},
				{
					kind: "failed",
					runId: "run-39",
					key: "acme/widget#39",
					factory: "work hub",
					reason: "stage review failed",
					since: "2026-10-25T12:30:00+00:00",
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("the queue of a hub gives each waiting ticket with its rank across the queue, link, wait and reason", async () => {
		const app = await serveFactories({
			"/daemon": hubAbout,
			"/sources": queueSources,
			"/holds": holds,
			"/runs": { runs: [] },
			"/machine": machine,
		});
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) => seen.queue.length === 4,
			);
			expect(page.queue).toEqual([
				{
					factory: "work hub",
					source: "acme-github",
					rank: 1,
					key: "acme/widget#46",
					url: "https://github.com/acme/widget/issues/46",
					waits: "held",
					since: "2026-10-25T13:57:00+00:00",
					hold: { failures: 3, since: "2026-10-25T14:00:13.795148+00:00" },
				},
				{
					factory: "work hub",
					source: "acme-github",
					rank: 2,
					key: "acme/widget#47",
					url: "https://github.com/acme/widget/issues/47",
					waits: "blocked by #46",
					since: "2026-10-25T14:05:00+00:00",
				},
				{
					factory: "work hub",
					source: "acme-github",
					rank: 3,
					key: "acme/widget#48",
					url: "https://github.com/acme/widget/issues/48",
					waits: "comments wait",
					since: null,
				},
				{
					factory: "work hub",
					source: "widget-launch",
					rank: 4,
					key: "PF-12",
					waits: "blocked by PF-11",
					since: "2026-10-25T12:00:00.761000+00:00",
				},
			]);
			expect(page.tiles).toMatchObject({
				queued: 4,
				longestWaitSince: "2026-10-25T12:00:00.761000+00:00",
			});
			expect(page.notServed).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a hub that serves no holds still gives its queue, and a factory with no queue route is named", async () => {
		const app = await serveFactories(
			{
				"/daemon": hubAbout,
				"/sources": queueSources,
				"/runs": { runs: [] },
				"/machine": machine,
			},
			{
				"/daemon": { ...laptopAbout, role: "hub" },
				"/runs": { runs: [] },
				"/machine": machine,
			},
		);
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) => seen.queue.length === 4 && seen.notServed.length === 1,
			);
			expect(page.queue[0]).not.toHaveProperty("hold");
			expect(page.notServed).toEqual([
				{ factory: "laptop", panel: "queue", route: "GET /sources" },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a hub whose holds read fails, with a queue entry that does not parse, still gives its queue", async () => {
		const [first, ...rest] = queueSources.sources;
		const app = await serveFactories({
			"/daemon": hubAbout,
			"/sources": {
				sources: [
					{ ...first, queue: [{ ticket: 45 }, ...(first?.queue ?? [])] },
					...rest,
				],
			},
			"/holds": new Response("boom", { status: 500 }),
			"/runs": { runs: [] },
		});
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) => seen.queue.length === 4,
			);
			expect(page.queue.map((item) => item.key)).toEqual([
				"acme/widget#46",
				"acme/widget#47",
				"acme/widget#48",
				"PF-12",
			]);
			expect(page.queue[0]).not.toHaveProperty("hold");
			expect(
				app.requests.some((request) => request.url.endsWith("/holds")),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a factory that does not answer is marked, and the other factory's data stays", async () => {
		const app = await serveFactories(hubAnswers, "down");
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					seen.running.length === 3 &&
					seen.boxes.some((box) => box.reachable === false),
			);
			expect(page.boxes).toEqual([
				{
					name: "work hub",
					role: "hub",
					reachable: true,
					slots: { total: 12, used: 3 },
					heartbeatAt: clockStart,
				},
				{
					name: "laptop",
					role: null,
					reachable: false,
					heartbeatAt: null,
				},
			]);
			expect(page.tiles.slots).toEqual({ total: 12, used: 3 });
			expect(page.running.map((run) => run.factory)).toEqual([
				"work hub",
				"work hub",
				"work hub",
			]);
			expect(
				app.requests.some((request) => request.unix === laptopSocket),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a factory feed event sends an overview event, and the Factories tab then reads the new stage", async () => {
		const feed = new EventFeed();
		const app = await serveFactories({
			...hubAnswers,
			"/runs": { runs: [running41] },
			"/events": feed,
		});
		const stream = openEventStream(app.base);
		try {
			await feed.connected(1);
			await factoriesWhere(app.base, (seen) => seen.running.length === 1);
			await stream.ready;
			const [planStarted] = hubEvents;
			feed.send({ ...planStarted, run_id: "run-41" });
			for await (const event of stream.events) {
				if (event.event === "overview") {
					const page = await factoriesWhere(app.base, () => true);
					if (page.running[0]?.stage === "plan") {
						break;
					}
				}
			}
			const page = await factoriesWhere(app.base, () => true);
			expect(page.running[0]).toMatchObject({
				id: "run-41",
				stage: "plan",
				stageSince: planStarted?.recorded_at,
			});
		} finally {
			stream.close();
			await app.stop();
		}
	});
});
