import { describe, expect, test } from "bun:test";

import type { InsightAnswer } from "../../src/run-history.ts";
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
const dayMs = 24 * 60 * minuteMs;

const day = (date: number) => `2026-10-${String(date).padStart(2, "0")}`;

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

const buildSeconds = [600, 650, 700, 750, 800, 850, 900, 950, 1_000, 3_000];
const planSeconds = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const gateSeconds = 1;

/**
 * The ended runs before `anchor`: ten runs of the last 30 days and one of 40 days ago.
 * Each recent run completes `build`, its child stage `build/lint` and `gate`.
 * Nine of them complete `plan`. Only `build` has turns.
 */
function historyOf(anchor: number) {
	const iso = (time: number) => new Date(time).toISOString();
	const recent = buildSeconds.map((seconds, index) => {
		const start = anchor - (index + 1) * dayMs;
		const plan = planSeconds[index];
		const id = `run-s${index}`;
		return {
			id,
			run: endedRun(id, iso(start + 40 * minuteMs)),
			log: [
				...(plan === undefined ? [] : [completed("plan", iso(start), plan)]),
				completed("gate", iso(start + minuteMs), gateSeconds),
				...(index === buildSeconds.length - 1
					? [
							{
								event: "stage.failed",
								stage: "build",
								at: iso(start + 2 * minuteMs),
								data: {
									duration: 120,
									error: "tests failed",
									will_retry: true,
								},
							},
							{
								event: "stage.retrying",
								stage: "build",
								at: iso(start + 3 * minuteMs),
								data: { attempt: 1 },
							},
						]
					: []),
				completed("build/lint", iso(start + 29 * minuteMs), 30),
				completed("build", iso(start + 30 * minuteMs), seconds),
			],
		};
	});
	const old = anchor - 40 * dayMs;
	return [
		...recent,
		{
			id: "run-old",
			run: endedRun("run-old", iso(old)),
			log: [completed("build", iso(old), 99_000)],
		},
	];
}

function historyAnswers(anchor: number, live: unknown[]): Answers {
	const history = historyOf(anchor);
	return {
		"/daemon": hubAbout,
		"/sources": { sources: [] },
		"/runs": { runs: [...live, ...history.map((item) => item.run)] },
		...Object.fromEntries(
			history.flatMap(({ id, log }) => [
				[`/runs/${id}/events`, eventLog(id, log)],
				[`/runs/${id}/turns`, { turns: [buildTurn(1), buildTurn(0.5)] }],
			]),
		),
	};
}

const historyReady = (page: { stages: { stage: string; samples: number }[] }) =>
	page.stages.find((stage) => stage.stage === "build")?.samples === 10 &&
	page.stages.find((stage) => stage.stage === "plan")?.samples === 9 &&
	page.stages.find((stage) => stage.stage === "gate")?.samples === 10;

/** The app with live runs that each start a stage at `clockStart` through the factory feed. */
async function serveLive(stages: Record<string, string>) {
	const feed = new EventFeed();
	const clock = { now: Date.parse(clockStart) };
	const live = Object.keys(stages).map((id, index) =>
		hubRun({ id, ticket: String(41 + 2 * index), started_at: clockStart }),
	);
	const app = await serveFactories(
		{ ...historyAnswers(Date.parse(clockStart), live), "/events": feed },
		undefined,
		() => new Date(clock.now),
	);
	await feed.connected(1);
	const [started] = hubEvents;
	for (const [id, stage] of Object.entries(stages)) {
		feed.send({
			...started,
			id: `${id}-started`,
			run_id: id,
			recorded_at: clockStart,
			item: { event: "stage.started", node_path: stage, data: {} },
		});
	}
	await factoriesWhere(
		app.base,
		(seen) =>
			historyReady(seen) &&
			seen.running.length === live.length &&
			seen.running.every((run) => run.stageSince === clockStart),
	);
	return { app, clock };
}

const at = (minutes: number) => Date.parse(clockStart) + minutes * minuteMs;

describe("the stage durations of the Factories tab", () => {
	test("each entry graph stage of the last 30 days gives its runs, p50, p95, retries and cost for each run", async () => {
		const app = await serveFactories(
			historyAnswers(Date.parse(clockStart), []),
		);
		try {
			const page = await factoriesWhere(app.base, historyReady);
			expect(page.stages).toEqual([
				{
					stage: "build",
					role: "agent",
					runs: 10,
					samples: 10,
					p50S: 800,
					p95S: 3_000,
					retriesPerRun: 0.1,
					costPerRun: 1.5,
				},
				{
					stage: "plan",
					role: "tool",
					runs: 9,
					samples: 9,
					p50S: 500,
					p95S: 900,
					retriesPerRun: 0,
					costPerRun: null,
				},
				{
					stage: "gate",
					role: "tool",
					runs: 10,
					samples: 10,
					p50S: gateSeconds,
					p95S: gateSeconds,
					retriesPerRun: 0,
					costPerRun: null,
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a run past the p95 of a long stage is stalled in running now and needs attention, and a stage with 9 ended runs gives no stall", async () => {
		const { app, clock } = await serveLive({
			"run-41": "build",
			"run-43": "plan",
		});
		try {
			clock.now = at(49);
			const before = await factoriesWhere(app.base, () => true);
			expect(before.running.map((run) => run.stall)).toEqual([
				undefined,
				undefined,
			]);
			expect(before.attention).toEqual([]);

			clock.now = at(51);
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
					since: new Date(at(50)).toISOString(),
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

	test("a run past the tiny p95 of a short tool stage is not stalled until it spends 10 minutes in the stage", async () => {
		const { app, clock } = await serveLive({ "run-41": "gate" });
		try {
			clock.now = at(9);
			const early = await factoriesWhere(app.base, () => true);
			expect(early.running[0]?.stall).toBeUndefined();
			expect(early.attention).toEqual([]);

			clock.now = at(11);
			const late = await factoriesWhere(
				app.base,
				(seen) => seen.attention.length > 0,
			);
			expect(late.running[0]?.stall).toEqual({ p95S: gateSeconds });
			expect(late.attention).toMatchObject([
				{
					kind: "stalled",
					reason: "gate",
					since: new Date(at(10)).toISOString(),
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("?stageDays= picks the days of the stage durations, and the stall rule keeps its 30 days", async () => {
		const { app, clock } = await serveLive({ "run-41": "build" });
		const buildSamples = (page: {
			stages: { stage: string; samples: number }[];
		}) => page.stages.find((stage) => stage.stage === "build")?.samples;
		try {
			const week = await factoriesWhere(app.base, () => true, "?stageDays=7");
			expect(buildSamples(week)).toBe(7);

			clock.now = at(51);
			const quarter = await factoriesWhere(
				app.base,
				(seen) => seen.attention.length > 0,
				"?stageDays=90",
			);
			expect(buildSamples(quarter)).toBe(11);
			expect(quarter.running[0]?.stall).toEqual({ p95S: 3_000 });
		} finally {
			await app.stop();
		}
	});

	test("the Slowest stages by p95 insight gives the p95 of each stage that the tab gives", async () => {
		const now = Date.now();
		const app = await serveFactories(
			historyAnswers(now, []),
			undefined,
			() => new Date(now),
		);
		try {
			const page = await factoriesWhere(app.base, historyReady);
			const saved = (await (
				await fetch(new URL("/api/insights/saved", app.base))
			).json()) as { queries: { name: string; sql: string }[] };
			const slowest = saved.queries.find(
				(query) => query.name === "Slowest stages by p95",
			);
			if (slowest === undefined) {
				throw new Error("the starting insights lost Slowest stages by p95");
			}
			const answer = (await (
				await fetch(new URL("/api/insights/query", app.base), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sql: slowest.sql }),
				})
			).json()) as InsightAnswer;
			const p95Minutes = new Map(
				answer.rows.map(([stage, minutes]) => [stage, minutes]),
			);
			expect(
				page.stages.map((stage) => [stage.stage, p95Minutes.get(stage.stage)]),
			).toEqual(
				page.stages.map((stage) => [
					stage.stage,
					Math.round((stage.p95S / 60) * 10) / 10,
				]),
			);
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

	test("?outcomeDays= picks how many days the outcomes give, and a range the tab does not offer gives 14", async () => {
		const app = await serveFactories({
			"/daemon": hubAbout,
			"/sources": { sources: [] },
			"/runs": { runs: [] },
		});
		try {
			const days = async (search: string) =>
				(await factoriesWhere(app.base, () => true, search)).outcomes.map(
					(outcome) => outcome.day,
				);
			expect(await days("?outcomeDays=7")).toEqual(
				Array.from({ length: 7 }, (_, index) => day(19 + index)),
			);
			expect(await days("?outcomeDays=90")).toHaveLength(90);
			expect(await days("?outcomeDays=5")).toHaveLength(14);
		} finally {
			await app.stop();
		}
	});
});
