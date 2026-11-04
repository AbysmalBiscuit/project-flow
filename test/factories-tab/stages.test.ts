import { describe, expect, test } from "bun:test";

import hubEvents from "../fixtures/factory-hub-events.json";
import { type Answers, EventFeed, eventLog } from "../support/factory.ts";
import {
	clockStart,
	factoriesWhere,
	hubAbout,
	hubRun,
	serveFactories,
	usage,
} from "./_support.ts";

const minuteMs = 60_000;

function endedRun(id: string, endedAt: string) {
	return hubRun({
		id,
		ticket: id.replace("run-", ""),
		status: { kind: "succeeded", reason: null },
		started_at: endedAt,
		ended_at: endedAt,
		usage: usage(1),
	});
}

function completed(stage: string, at: string, duration: number) {
	return { event: "stage.completed", stage, at, data: { duration } };
}

function buildTurn(costUsd: number) {
	return {
		node_path: "build",
		session: "5b1f7c2e-0d4a-4c1e-9b61-2f7d3e8a9c10",
		tools: { Bash: 1 },
		tokens: { input: 1_000, output: 100 },
		cost_usd: costUsd,
		duration_s: 60,
	};
}

/**
 * Five runs of the last 30 days that each complete `build` and its child stage
 * `build/lint`, four of which complete `plan`, and one run of 40 days ago.
 * `build` has turns and `plan` has none.
 */
const buildSeconds = [600, 700, 800, 900, 3_000];
const planSeconds = [100, 200, 300, 400];
const day = (date: number) => `2026-10-${String(date).padStart(2, "0")}`;
const historyRuns = buildSeconds.map((seconds, index) => {
	const at = `${day(20 + index)}T08:00:00+00:00`;
	const plan = planSeconds[index];
	const id = `run-s${index}`;
	return {
		id,
		run: endedRun(id, at),
		log: [
			...(plan === undefined ? [] : [completed("plan", at, plan)]),
			...(index === 4
				? [
						{
							event: "stage.failed",
							stage: "build",
							at,
							data: { duration: 120, error: "tests failed", will_retry: true },
						},
						{
							event: "stage.retrying",
							stage: "build",
							at: `${day(20 + index)}T08:00:01+00:00`,
							data: { attempt: 1 },
						},
					]
				: []),
			completed("build/lint", `${day(20 + index)}T08:29:00+00:00`, 30),
			completed("build", `${day(20 + index)}T08:30:00+00:00`, seconds),
		],
	};
});
const oldRun = {
	id: "run-old",
	run: endedRun("run-old", "2026-09-10T08:00:00+00:00"),
	log: [completed("build", "2026-09-10T08:00:00+00:00", 99_000)],
};

function historyAnswers(live: unknown[]): Answers {
	return {
		"/daemon": hubAbout,
		"/sources": { sources: [] },
		"/runs": {
			runs: [...live, ...[...historyRuns, oldRun].map((item) => item.run)],
		},
		...Object.fromEntries(
			[...historyRuns, oldRun].flatMap(({ id, log }) => [
				[`/runs/${id}/events`, eventLog(id, log)],
				[`/runs/${id}/turns`, { turns: [buildTurn(1), buildTurn(0.5)] }],
			]),
		),
	};
}

describe("the stage durations of the Factories tab", () => {
	test("each entry graph stage of the last 30 days gives its runs, p50, p95, retries and cost for each run", async () => {
		const app = await serveFactories(historyAnswers([]));
		try {
			const page = await factoriesWhere(
				app.base,
				(seen) =>
					seen.stages.find((stage) => stage.stage === "build")?.runs === 5 &&
					seen.stages.some((stage) => stage.stage === "plan"),
			);
			expect(page.stages).toEqual([
				{
					stage: "build",
					role: "agent",
					runs: 5,
					samples: 5,
					p50S: 800,
					p95S: 3_000,
					retriesPerRun: 0.2,
					costPerRun: 1.5,
				},
				{
					stage: "plan",
					role: "tool",
					runs: 4,
					samples: 4,
					p50S: 200,
					p95S: 400,
					retriesPerRun: 0,
					costPerRun: null,
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a live run past the p95 of its stage is stalled in running now and needs attention, and a stage with 4 samples gives no stall", async () => {
		const feed = new EventFeed();
		let now = Date.parse(clockStart) + 10 * minuteMs;
		const building = hubRun({ id: "run-41", started_at: clockStart });
		const planning = hubRun({
			id: "run-43",
			ticket: "43",
			started_at: clockStart,
		});
		const app = await serveFactories(
			{ ...historyAnswers([building, planning]), "/events": feed },
			undefined,
			() => new Date(now),
		);
		try {
			await feed.connected(1);
			const [planStarted] = hubEvents;
			feed.send({
				...planStarted,
				id: "build-started",
				run_id: "run-41",
				recorded_at: clockStart,
				item: { event: "stage.started", node_path: "build", data: {} },
			});
			feed.send({
				...planStarted,
				id: "plan-started",
				run_id: "run-43",
				recorded_at: clockStart,
			});
			const before = await factoriesWhere(
				app.base,
				(seen) =>
					seen.stages.find((stage) => stage.stage === "build")?.samples === 5 &&
					seen.stages.find((stage) => stage.stage === "plan")?.samples === 4 &&
					seen.running.every((run) => run.stageSince === clockStart),
			);
			expect(before.running.map((run) => run.stall)).toEqual([
				undefined,
				undefined,
			]);
			expect(before.attention).toEqual([]);

			now = Date.parse(clockStart) + 51 * minuteMs;
			const after = await factoriesWhere(
				app.base,
				(seen) => seen.attention.length > 0,
			);
			expect(
				after.running.map(({ id, stage, stall }) => ({ id, stage, stall })),
			).toEqual([
				{ id: "run-41", stage: "build", stall: { p95S: 3_000 } },
				{ id: "run-43", stage: "plan", stall: undefined },
			]);
			expect(after.attention).toEqual([
				{
					kind: "stalled",
					runId: "run-41",
					key: "acme/widget#41",
					factory: "work hub",
					reason: "build",
					since: new Date(Date.parse(clockStart) + 50 * minuteMs).toISOString(),
					p95S: 3_000,
				},
			]);
			expect(after.tiles.attention).toEqual({
				total: 1,
				failed: 0,
				stalled: 1,
				asks: 0,
			});
		} finally {
			await app.stop();
		}
	});
});

describe("the outcomes of the Factories tab", () => {
	test("each day of the last 14 days gives its merged, failed and stopped runs", async () => {
		const ended = (
			id: string,
			endedAt: string,
			status: { kind: string; reason: string | null },
		) =>
			hubRun({
				id,
				ticket: id.replace("run-", ""),
				status,
				started_at: endedAt,
				ended_at: endedAt,
			});
		const merged40 = ended("run-40", "2026-10-25T13:48:02+00:00", {
			kind: "succeeded",
			reason: null,
		});
		const app = await serveFactories({
			"/daemon": hubAbout,
			"/sources": { sources: [] },
			"/runs": {
				runs: [
					merged40,
					ended("run-39", "2026-10-25T12:30:00+00:00", {
						kind: "failed",
						reason: "stage review failed",
					}),
					ended("run-37", "2026-10-24T13:00:00+00:00", {
						kind: "failed",
						reason: "network",
					}),
					ended("run-36", "2026-10-12T00:10:00+00:00", {
						kind: "failed",
						reason: "stopped",
					}),
					ended("run-35", "2026-10-11T23:50:00+00:00", {
						kind: "failed",
						reason: "network",
					}),
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
		});
		try {
			const page = await factoriesWhere(app.base, (seen) =>
				seen.outcomes.some((outcome) => outcome.merged === 1),
			);
			const counts: Record<
				string,
				{ merged: number; failed: number; stopped: number }
			> = {
				"2026-10-12": { merged: 0, failed: 0, stopped: 1 },
				"2026-10-24": { merged: 0, failed: 1, stopped: 0 },
				"2026-10-25": { merged: 1, failed: 1, stopped: 0 },
			};
			expect(page.outcomes).toEqual(
				Array.from({ length: 14 }, (_, index) => {
					const date = day(12 + index);
					return {
						day: date,
						...(counts[date] ?? { merged: 0, failed: 0, stopped: 0 }),
					};
				}),
			);
		} finally {
			await app.stop();
		}
	});
});
