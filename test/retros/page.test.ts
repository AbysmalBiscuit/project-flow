import { expect, test } from "bun:test";

import type { RetrosPage, RunRetro } from "../../src/retros-page.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import roughRetro from "../fixtures/factory-run-retro.json";
import { answerWhere, serveHub } from "../insights/_support.ts";
import { type Answers, hub } from "../support/factory.ts";

function runOf(ticket: string) {
	const found = hubRuns.runs.find((run) => run.ticket === ticket);
	if (found === undefined) {
		throw new Error(`the hub runs fixture lost the run of ticket ${ticket}`);
	}
	return found;
}

const failedRun = runOf("39");
const succeededRun = runOf("40");
const runningRun = runOf("41");
/** A third ended run, so the filter has a run below rough to drop. */
const bumpyRun = {
	...succeededRun,
	id: "20261025-110000-b9c0",
	ticket: "38",
	ended_at: "2026-10-25T11:40:00+00:00",
};

/** The retro of run 39: a retry of `build`, then a failure of `review`. */
const failedRetro = {
	facts: {
		outcome: "failed",
		failure: "stage review failed",
		duration_s: 1800,
		cost_usd: 4.5,
		tokens: { input: 1000, output: 100 },
		rounds: { review: 1, pr: 0 },
		stages: {
			plan: { visits: 1, retries: 0 },
			build: { visits: 1, retries: 1 },
			review: { visits: 1, retries: 0 },
		},
		questions: [],
		steers: 0,
		restarts: 0,
		resumes: 0,
	},
	friction: [
		{
			kind: "retry",
			stage: "build",
			time_s: 600.2,
			at: "2026-10-25T12:10:00+00:00",
			detail: "tests failed",
		},
		{
			kind: "failure",
			stage: "review",
			time_s: 300,
			at: "2026-10-25T12:30:00+00:00",
			detail: "stage review failed",
		},
	],
	time_lost_s: 900.2,
	smoothness: "failed",
};

/** The retro of run 38: one retry with the same cause as run 39's. */
const bumpyRetro = {
	facts: {
		...failedRetro.facts,
		outcome: "succeeded",
		failure: null,
		duration_s: 1200,
		cost_usd: 2,
		stages: { build: { visits: 1, retries: 1 } },
	},
	friction: [
		{
			kind: "retry",
			stage: "build",
			time_s: 120,
			at: "2026-10-25T11:20:00+00:00",
			detail: "Tests failed",
		},
	],
	time_lost_s: 120,
	smoothness: "bumpy",
};

/** A `GET /runs/{id}/events` answer of an ended run: each event, then the end of the stream. */
function eventLog(
	runId: string,
	items: { event: string; stage: string; at: string; data: unknown }[],
): Response {
	return new Response(
		items
			.map(
				(item, index) =>
					`id: ${runId}-${index}\ndata: ${JSON.stringify({
						run_id: runId,
						id: `${runId}-${index}`,
						recorded_at: item.at,
						item: { event: item.event, node_path: item.stage, data: item.data },
					})}\n\n`,
			)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

const failedLog = eventLog(failedRun.id, [
	{
		event: "stage.completed",
		stage: "plan",
		at: "2026-10-25T12:02:00+00:00",
		data: { duration: 120 },
	},
	{
		event: "stage.failed",
		stage: "build",
		at: "2026-10-25T12:10:00+00:00",
		data: { error: "tests failed", will_retry: true, duration: 480 },
	},
	{
		event: "stage.retrying",
		stage: "build",
		at: "2026-10-25T12:10:01+00:00",
		data: { attempt: 1, delay: 0.2 },
	},
	{
		event: "stage.completed",
		stage: "build",
		at: "2026-10-25T12:25:00+00:00",
		data: { duration: 900 },
	},
	{
		event: "stage.failed",
		stage: "review",
		at: "2026-10-25T12:30:00+00:00",
		data: { error: "stage review failed", will_retry: false, duration: 300 },
	},
]);

const recorded: Answers = {
	...hub,
	"/runs": { runs: [...hubRuns.runs, bumpyRun] },
	[`/runs/${succeededRun.id}/retro`]: roughRetro,
	[`/runs/${failedRun.id}/retro`]: failedRetro,
	[`/runs/${bumpyRun.id}/retro`]: bumpyRetro,
	[`/runs/${failedRun.id}/events`]: failedLog,
};

const serveAt = (answers: Answers) =>
	serveHub(answers, undefined, () => new Date("2026-10-26T00:00:00Z"));

async function readJson<T>(base: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, base));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

async function pageWhere(
	base: string,
	accept: (page: RetrosPage) => boolean,
	path = "/api/retros",
): Promise<RetrosPage> {
	while (true) {
		const page = await readJson<RetrosPage>(base, path);
		if (accept(page)) {
			return page;
		}
		await Bun.sleep(20);
	}
}

test("the recorded retros give the run list, and the filter keeps only rough or worse runs", async () => {
	const app = await serveAt(recorded);
	try {
		const page = await pageWhere(app.base, (found) => found.runs.length === 3);
		expect(page.notServed).toEqual([]);
		expect(
			page.runs.map((run) => [
				run.ticket,
				run.smoothness,
				run.rounds,
				run.friction,
				run.timeLostS,
			]),
		).toEqual([
			["acme/widget#40", "rough", 3, 1, 1552.489089],
			["acme/widget#39", "failed", 1, 2, 900.2],
			["acme/widget#38", "bumpy", 1, 1, 120],
		]);
		expect(page.runs[0]).toMatchObject({
			id: succeededRun.id,
			result: "noPr",
			durationS: 4881.903707,
			costUsd: 25.8437478,
		});
		const rough = await readJson<RetrosPage>(
			app.base,
			"/api/retros?atLeast=rough",
		);
		expect(rough.runs.map((run) => run.ticket)).toEqual([
			"acme/widget#40",
			"acme/widget#39",
		]);
	} finally {
		await app.stop();
	}
});

test("the friction points across runs group by kind and cause, with the count of runs", async () => {
	const app = await serveAt(recorded);
	try {
		const page = await pageWhere(app.base, (found) => found.runs.length === 3);
		expect(page.friction).toEqual([
			{ kind: "retry", cause: "tests failed", runs: 2 },
			{ kind: "question", cause: "post_pr/rebase_held", runs: 1 },
			{ kind: "failure", cause: "stage review failed", runs: 1 },
		]);
	} finally {
		await app.stop();
	}
});

test("the retro of a failed run gives its tiles, its stage table and its friction points", async () => {
	const app = await serveAt(recorded);
	try {
		await pageWhere(app.base, (found) => found.runs.length === 3);
		const run = await readJson<RunRetro>(
			app.base,
			`/api/retros/runs/${failedRun.id}`,
		);
		expect(run.notServed).toBe(false);
		expect(run.ticket).toBe("acme/widget#39");
		expect(run.retro).toMatchObject({
			smoothness: "failed",
			outcome: "failed",
			failure: "stage review failed",
			durationS: 1800,
			costUsd: 4.5,
			rounds: 1,
			retries: 1,
			timeLostS: 900.2,
		});
		expect(run.retro?.stages).toEqual([
			{ stage: "plan", seconds: 120, visits: 1, retries: 0, lostS: 0 },
			{ stage: "build", seconds: 1380, visits: 1, retries: 1, lostS: 600.2 },
			{ stage: "review", seconds: 300, visits: 1, retries: 0, lostS: 300 },
		]);
		expect(run.retro?.friction.map((point) => point.kind)).toEqual([
			"retry",
			"failure",
		]);
		expect(run.retro?.friction[0]).toEqual({
			kind: "retry",
			stage: "build",
			timeS: 600.2,
			at: "2026-10-25T12:10:00+00:00",
			detail: "tests failed",
		});
	} finally {
		await app.stop();
	}
});

test("the retro of each ended run is read once, and Insights queries it", async () => {
	const app = await serveAt(recorded);
	try {
		await pageWhere(app.base, (found) => found.runs.length === 3);
		await readJson<RunRetro>(app.base, `/api/retros/runs/${succeededRun.id}`);
		const reads = (runId: string) =>
			app.paths().filter((path) => path === `/runs/${runId}/retro`);
		expect(reads(succeededRun.id)).toHaveLength(1);
		expect(reads(failedRun.id)).toHaveLength(1);
		expect(reads(runningRun.id)).toEqual([]);
		const answer = await answerWhere(
			app.base,
			"select run_id, smoothness, friction, time_lost_s from retros order by run_id",
			(count) => count === 3,
		);
		expect(answer.rows).toEqual([
			[bumpyRun.id, "bumpy", 1, 120],
			[failedRun.id, "failed", 2, 900.2],
			[succeededRun.id, "rough", 1, 1552.489089],
		]);
	} finally {
		await app.stop();
	}
});

test("a factory with no retro route gets the not served note", async () => {
	const app = await serveAt(hub);
	try {
		const page = await pageWhere(
			app.base,
			(found) => found.notServed.length > 0,
		);
		expect(page.notServed).toEqual(["work hub"]);
		expect(page.runs).toEqual([]);
		const run = await readJson<RunRetro>(
			app.base,
			`/api/retros/runs/${succeededRun.id}`,
		);
		expect(run.notServed).toBe(true);
		expect(run.retro).toBeNull();
	} finally {
		await app.stop();
	}
});

test("a factory that serves the route after a 404 stores the retro that the run's read gets", async () => {
	let served = false;
	const app = await serveAt({
		...hub,
		[`/runs/${succeededRun.id}/retro`]: () => (served ? roughRetro : null),
	});
	try {
		await pageWhere(app.base, (found) => found.notServed.length > 0);
		served = true;
		const run = await readJson<RunRetro>(
			app.base,
			`/api/retros/runs/${succeededRun.id}`,
		);
		expect(run.retro?.smoothness).toBe("rough");
		const page = await readJson<RetrosPage>(app.base, "/api/retros");
		expect(page.runs.map((row) => row.id)).toEqual([succeededRun.id]);
		expect(page.notServed).toEqual([]);
	} finally {
		await app.stop();
	}
});
