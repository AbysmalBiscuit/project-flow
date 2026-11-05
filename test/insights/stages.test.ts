import { expect, test } from "bun:test";

import hubEvents from "../fixtures/factory-hub-events.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import answeredAsks from "../fixtures/factory-run-questions-answered.json";
import runTurns from "../fixtures/factory-run-turns.json";
import { type Answers, EventFeed, eventLog, hub } from "../support/factory.ts";
import { answerWhere, insightTables, serveHub } from "./_support.ts";

const runPollMs = 10_000;

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
const queuedRun = runOf("42");

const succeededLog = eventLog(succeededRun.id, [
	{
		event: "stage.started",
		stage: "plan",
		at: "2026-10-25T13:05:21+00:00",
		data: { name: "plan", index: 1 },
	},
	{
		event: "stage.completed",
		stage: "plan",
		at: "2026-10-25T13:10:00+00:00",
		data: { name: "plan", index: 1, duration: 279 },
	},
	{
		event: "stage.failed",
		stage: "build",
		at: "2026-10-25T13:20:00+00:00",
		data: {
			name: "build",
			index: 2,
			error: "tests failed",
			will_retry: true,
			duration: 600,
		},
	},
	{
		event: "stage.retrying",
		stage: "build",
		at: "2026-10-25T13:20:01+00:00",
		data: { name: "build", index: 2, attempt: 1, delay: 0.2 },
	},
	{
		event: "stage.completed",
		stage: "build",
		at: "2026-10-25T13:40:00+00:00",
		data: { name: "build", index: 2, duration: 1199 },
	},
]);

const backfilled: Answers = {
	...hub,
	[`/runs/${succeededRun.id}/events`]: succeededLog,
	[`/runs/${succeededRun.id}/turns`]: runTurns,
	[`/runs/${failedRun.id}/events`]: eventLog(failedRun.id, []),
	[`/runs/${failedRun.id}/turns`]: { turns: [] },
	[`/runs/${succeededRun.id}/questions`]: answeredAsks,
};

const stagesSql =
	"select run_id, stage, event, at, duration_s, will_retry, attempt, error from stages order by at";

test("a stage.completed event of the factory feed gives a stage row", async () => {
	const feed = new EventFeed();
	const app = await serveHub({ ...hub, "/events": feed });
	try {
		await feed.connected(1);
		const [, planCompleted] = hubEvents;
		feed.send(planCompleted);
		const answer = await answerWhere(
			app.base,
			`select run_id, stage, event, at, duration_s from stages where run_id = '${runningRun.id}'`,
			(count) => count > 0,
		);
		expect(answer.rows).toEqual([
			[
				runningRun.id,
				"plan",
				"stage.completed",
				"2026-10-25T14:24:41.087+00:00",
				217.6,
			],
		]);
	} finally {
		await app.stop();
	}
});

test("on an empty store the backfill reads the event log and the turns of each ended run once, and of no live run", async () => {
	const app = await serveHub(backfilled);
	try {
		const stages = await answerWhere(
			app.base,
			stagesSql,
			(count) => count === 4,
		);
		expect(stages.rows).toEqual([
			[
				succeededRun.id,
				"plan",
				"stage.completed",
				"2026-10-25T13:10:00+00:00",
				279,
				null,
				null,
				null,
			],
			[
				succeededRun.id,
				"build",
				"stage.failed",
				"2026-10-25T13:20:00+00:00",
				600,
				1,
				null,
				"tests failed",
			],
			[
				succeededRun.id,
				"build",
				"stage.retrying",
				"2026-10-25T13:20:01+00:00",
				null,
				null,
				1,
				null,
			],
			[
				succeededRun.id,
				"build",
				"stage.completed",
				"2026-10-25T13:40:00+00:00",
				1199,
				null,
				null,
				null,
			],
		]);
		const turns = await answerWhere(
			app.base,
			"select run_id, turn, stage, input_tokens, output_tokens, cost_usd, duration_s, tools, harness, model from turns order by turn",
			(count) => count === runTurns.turns.length,
		);
		expect(turns.rows[0]).toEqual([
			succeededRun.id,
			0,
			"plan",
			41200,
			1830,
			0.3125,
			94.5,
			JSON.stringify({ Read: 6, Bash: 2 }),
			"claude",
			"claude-opus-5-5",
		]);
		expect(turns.rows.map((row) => row.slice(-2))).toEqual([
			["claude", "claude-opus-5-5"],
			["claude", "claude-opus-5-5"],
			["codex", "gpt-6.1-sol"],
			[null, null],
		]);
		const paths = app.paths();
		for (const run of [failedRun, succeededRun]) {
			expect(
				paths.filter((path) => path === `/runs/${run.id}/events`),
			).toHaveLength(1);
			expect(
				paths.filter((path) => path === `/runs/${run.id}/turns`),
			).toHaveLength(1);
		}
		for (const run of [runningRun, queuedRun]) {
			expect(
				paths.filter(
					(path) =>
						path === `/runs/${run.id}/events` ||
						path === `/runs/${run.id}/turns`,
				),
			).toEqual([]);
		}
	} finally {
		await app.stop();
	}
});

test("a second run poll sends no more turns reads for the ended runs", async () => {
	let now = Date.parse("2026-10-25T15:00:00Z");
	const app = await serveHub(backfilled, undefined, () => new Date(now));
	const turnsReads = () =>
		app.paths().filter((path) => path.endsWith("/turns")).length;
	const runReads = () => app.paths().filter((path) => path === "/runs").length;
	try {
		await answerWhere(
			app.base,
			"select run_id from turns",
			(count) => count === runTurns.turns.length,
		);
		while (turnsReads() < 2) {
			await Bun.sleep(10);
		}
		const before = runReads();
		now += runPollMs;
		while (runReads() === before) {
			await Bun.sleep(10);
		}
		await Bun.sleep(100);
		expect(turnsReads()).toBe(2);
	} finally {
		await app.stop();
	}
});

test("the answered asks of a run give ask rows", async () => {
	const app = await serveHub(backfilled);
	try {
		const answer = await answerWhere(
			app.base,
			"select run_id, id, stage, text, answer, sender, answered_at from asks order by id",
			(count) => count === 2,
		);
		const [first] = answeredAsks.answered;
		expect(answer.rows[0]).toEqual([
			succeededRun.id,
			"7",
			first?.node_path ?? null,
			first?.text ?? null,
			"Add the scope.",
			"lev",
			"2026-10-25T14:25:00+00:00",
		]);
	} finally {
		await app.stop();
	}
});

test("Insights lists the stages, turns, asks, verdicts, retros and host_samples tables", async () => {
	const app = await serveHub();
	try {
		const { tables } = await insightTables(app.base);
		expect(tables.map((table) => table.name)).toEqual([
			"runs",
			"stages",
			"turns",
			"asks",
			"verdicts",
			"retros",
			"host_samples",
		]);
		expect(tables.find((table) => table.name === "host_samples")).toEqual({
			name: "host_samples",
			columns: [
				"factory",
				"at",
				"taken_at",
				"uptime_s",
				"cores",
				"load_1m",
				"load_5m",
				"load_15m",
				"busy_percent",
				"iowait_percent",
				"memory_bytes",
				"available_bytes",
				"swap_bytes",
				"swap_used_bytes",
				"disks",
			],
		});
	} finally {
		await app.stop();
	}
});

test("a resumed run that ends again gets its turns read again", async () => {
	let now = Date.parse("2026-10-25T15:00:00Z");
	let endedAt = succeededRun.ended_at;
	const app = await serveHub(
		{
			...backfilled,
			"/runs": () => ({
				runs: hubRuns.runs.map((run) =>
					run.id === succeededRun.id ? { ...run, ended_at: endedAt } : run,
				),
			}),
		},
		undefined,
		() => new Date(now),
	);
	const turnsReads = () =>
		app.paths().filter((path) => path === `/runs/${succeededRun.id}/turns`)
			.length;
	try {
		while (turnsReads() < 1) {
			await Bun.sleep(10);
		}
		endedAt = "2026-10-25T16:00:00+00:00";
		now += runPollMs;
		while (turnsReads() < 2) {
			await Bun.sleep(10);
		}
		expect(turnsReads()).toBe(2);
	} finally {
		await app.stop();
	}
});
