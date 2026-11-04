import { describe, expect, test } from "bun:test";

import hubRuns from "../fixtures/factory-hub-runs.json";
import { hub } from "../support/factory.ts";
import {
	answerWhere,
	insightQuery,
	insightTables,
	serveHub,
} from "./_support.ts";

const runsSql =
	"select id, ticket, package, status, reason, result, factory, box, submitted_at, ended_at, cost_usd from runs order by submitted_at";

const usedRun = {
	...hubRuns.runs[1],
	usage: {
		tokens: { input: 1200, output: 300 },
		cost_usd: 2.5,
		duration_s: 600,
	},
};

const answers = {
	...hub,
	"/runs": { runs: [hubRuns.runs[0], usedRun, ...hubRuns.runs.slice(2)] },
};

const allRuns = (count: number) => count === hubRuns.runs.length;

describe("the Insights route", () => {
	test("a SELECT over runs gives the columns and rows of the runs that the factory reports", async () => {
		const app = await serveHub(answers);
		try {
			const answer = await answerWhere(app.base, runsSql, allRuns);
			expect(answer.columns).toEqual([
				"id",
				"ticket",
				"package",
				"status",
				"reason",
				"result",
				"factory",
				"box",
				"submitted_at",
				"ended_at",
				"cost_usd",
			]);
			expect(answer.rows).toEqual([
				[
					"20261025-120000-a7b8",
					"acme/widget#39",
					"workcell",
					"failed",
					"stage review failed",
					"failed",
					"work hub",
					"box-a",
					"2026-10-25T12:00:00+00:00",
					"2026-10-25T12:30:00+00:00",
					null,
				],
				[
					"20261025-130511-c3d4",
					"acme/widget#40",
					"workcell",
					"succeeded",
					null,
					"noPr",
					"work hub",
					"box-b",
					"2026-10-25T13:05:11+00:00",
					"2026-10-25T13:48:02+00:00",
					2.5,
				],
				[
					"20261025-140102-a1b2",
					"acme/widget#41",
					"workcell",
					"running",
					null,
					null,
					"work hub",
					"box-a",
					"2026-10-25T14:01:02+00:00",
					null,
					null,
				],
				[
					"20261025-141500-e5f6",
					"acme/widget#42",
					"workcell",
					"queued",
					null,
					null,
					"work hub",
					null,
					"2026-10-25T14:15:00+00:00",
					null,
					null,
				],
			]);
			expect(answer.truncated).toBe(false);
			expect(answer.ms).toBeGreaterThanOrEqual(0);
		} finally {
			await app.stop();
		}
	});

	test("the route lists the queryable tables with their columns, and runs is one of them", async () => {
		const app = await serveHub();
		try {
			const { tables } = await insightTables(app.base);
			const runs = tables.find((table) => table.name === "runs");
			expect(runs?.columns).toEqual([
				"id",
				"ticket",
				"project",
				"package",
				"status",
				"reason",
				"result",
				"factory",
				"box",
				"submitted_at",
				"started_at",
				"ended_at",
				"archived_at",
				"input_tokens",
				"output_tokens",
				"cost_usd",
				"duration_s",
			]);
		} finally {
			await app.stop();
		}
	});

	test.each([
		["an INSERT", "insert into run_history (id) values ('x')"],
		["a DROP", "drop view runs"],
		["a DELETE", "delete from run_history"],
		["two statements", "select 1; delete from run_history"],
	])("refuses %s and leaves the store unchanged", async (_name, sql) => {
		const app = await serveHub();
		try {
			const before = await answerWhere(app.base, runsSql, allRuns);
			const refused = await insightQuery(app.base, sql);
			expect(refused.status).toBe(400);
			expect(refused.body).toEqual({ error: expect.any(String) });
			const after = await answerWhere(app.base, runsSql, () => true);
			expect(after.rows).toEqual(before.rows);
		} finally {
			await app.stop();
		}
	});

	test("a failed query gives the SQLite error", async () => {
		const app = await serveHub();
		try {
			const refused = await insightQuery(app.base, "select nope from runs");
			expect(refused).toEqual({
				status: 400,
				body: { error: "no such column: nope" },
			});
		} finally {
			await app.stop();
		}
	});

	test("a trailing semicolon and comment are one statement", async () => {
		const app = await serveHub();
		try {
			const answer = await answerWhere(
				app.base,
				"select 1 as one; -- the only statement\n",
				() => true,
			);
			expect(answer.rows).toEqual([[1]]);
		} finally {
			await app.stop();
		}
	});

	test("a result over 5,000 rows is cut at 5,000 and says so", async () => {
		const app = await serveHub();
		try {
			const answer = await answerWhere(
				app.base,
				"with recursive n(i) as (select 1 union all select i + 1 from n limit 6000) select i from n",
				() => true,
			);
			expect(answer.rowCount).toBe(5_000);
			expect(answer.rows.length).toBe(5_000);
			expect(answer.rows.at(-1)).toEqual([5_000]);
			expect(answer.truncated).toBe(true);
		} finally {
			await app.stop();
		}
	});
});
