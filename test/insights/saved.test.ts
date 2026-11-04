import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import hubRuns from "../fixtures/factory-hub-runs.json";
import { hub } from "../support/factory.ts";
import { answerWhere, insightQuery, serveHub } from "./_support.ts";

type Saved = { id: number; name: string; sql: string };

const startingNames = [
	"Cost per merged PR by week",
	"Failure reasons, 30 days",
	"Run results by day, 14 days",
	"Cost by project, 30 days",
	"Median run duration by week",
	"Merge rate by factory, 30 days",
	"Most expensive runs, 30 days",
	"Slowest stages by p95",
	"Retries by stage, 30 days",
	"Cost by stage, 30 days",
];

const byModel = "Cost by model, 30 days";

async function savedList(base: string): Promise<Saved[]> {
	const response = await fetch(new URL("/api/insights/saved", base));
	expect(response.status).toBe(200);
	return ((await response.json()) as { queries: Saved[] }).queries;
}

async function send(
	base: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	return fetch(new URL(path, base), {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function save(base: string, name: string, sql: string): Promise<Saved> {
	const response = await send(base, "POST", "/api/insights/saved", {
		name,
		sql,
	});
	expect(response.status).toBe(201);
	return (await response.json()) as Saved;
}

async function withStore(
	use: (databasePath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-saved-"));
	try {
		await use(join(root, "store.sqlite"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const allRuns = (count: number) => count === hubRuns.runs.length;

describe("saved Insights queries", () => {
	test("a saved query can be listed, renamed, changed and deleted", async () => {
		const app = await serveHub();
		try {
			const saved = await save(
				app.base,
				"Runs by box",
				"select box, count(*) as runs from runs group by box",
			);
			expect(saved).toEqual({
				id: expect.any(Number),
				name: "Runs by box",
				sql: "select box, count(*) as runs from runs group by box",
			});
			expect((await savedList(app.base)).at(-1)).toEqual(saved);

			const renamed = await send(
				app.base,
				"PATCH",
				`/api/insights/saved/${saved.id}`,
				{ name: "Runs of each box" },
			);
			expect(renamed.status).toBe(200);
			expect(await renamed.json()).toEqual({
				...saved,
				name: "Runs of each box",
			});

			const changed = await send(
				app.base,
				"PATCH",
				`/api/insights/saved/${saved.id}`,
				{ sql: "select box, count(*) as n from runs group by box" },
			);
			expect(await changed.json()).toEqual({
				id: saved.id,
				name: "Runs of each box",
				sql: "select box, count(*) as n from runs group by box",
			});

			const deleted = await send(
				app.base,
				"DELETE",
				`/api/insights/saved/${saved.id}`,
			);
			expect(deleted.status).toBe(204);
			expect(
				(await savedList(app.base)).map((query) => query.id),
			).not.toContain(saved.id);
			const gone = await send(
				app.base,
				"PATCH",
				`/api/insights/saved/${saved.id}`,
				{ name: "back" },
			);
			expect(gone.status).toBe(404);
		} finally {
			await app.stop();
		}
	});

	test.each([
		["no name", { name: " ", sql: "select 1" }],
		["no SQL", { name: "One", sql: "" }],
	])("a save with %s is refused", async (_case, body) => {
		const app = await serveHub();
		try {
			const response = await send(
				app.base,
				"POST",
				"/api/insights/saved",
				body,
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: expect.any(String) });
		} finally {
			await app.stop();
		}
	});

	test("a saved query stays after a restart on the same store and the refill of the run history", async () => {
		await withStore(async (databasePath) => {
			const first = await serveHub(hub, databasePath);
			let saved: Saved;
			try {
				saved = await save(
					first.base,
					"Runs",
					"select ticket, cost_usd from runs",
				);
			} finally {
				await first.stop();
			}
			const second = await serveHub(hub, databasePath);
			try {
				await answerWhere(second.base, "select id from runs", allRuns);
				expect(await savedList(second.base)).toContainEqual(saved);
			} finally {
				await second.stop();
			}
		});
	});
});

describe("starting insights", () => {
	test("a fresh store lists the starting insights whose tables exist, first the cost per merged PR", async () => {
		const app = await serveHub();
		try {
			const queries = await savedList(app.base);
			expect(queries.map((query) => query.name)).toEqual(startingNames);
		} finally {
			await app.stop();
		}
	});

	test("each starting insight runs and gives a label column and a number column", async () => {
		const app = await serveHub();
		try {
			await answerWhere(app.base, "select id from runs", allRuns);
			for (const query of await savedList(app.base)) {
				const { status, body } = await insightQuery(app.base, query.sql);
				expect({ name: query.name, status }).toEqual({
					name: query.name,
					status: 200,
				});
				if (!("rows" in body)) {
					throw new Error(`${query.name}: ${body.error}`);
				}
				expect(body.columns).toHaveLength(2);
				for (const [label, value] of body.rows) {
					expect(typeof label).toBe("string");
					expect(typeof value).toBe("number");
				}
			}
		} finally {
			await app.stop();
		}
	});

	test("a starting insight over a missing column stays out until the column exists", async () => {
		await withStore(async (databasePath) => {
			const first = await serveHub(hub, databasePath);
			try {
				expect(
					(await savedList(first.base)).map((query) => query.name),
				).not.toContain(byModel);
			} finally {
				await first.stop();
			}
			const db = new Database(databasePath);
			db.run("drop view turns");
			db.run(
				"create view turns as select run_id, turn, stage, input_tokens, output_tokens, cost_usd, duration_s, tools, null as model from run_turns",
			);
			db.close();
			const second = await serveHub(hub, databasePath);
			try {
				const names = (await savedList(second.base)).map((query) => query.name);
				expect(names).toEqual([...startingNames, byModel]);
			} finally {
				await second.stop();
			}
		});
	});

	test("a deleted or changed starting insight stays so after a restart", async () => {
		await withStore(async (databasePath) => {
			const first = await serveHub(hub, databasePath);
			try {
				const [cost, failures] = await savedList(first.base);
				if (cost === undefined || failures === undefined) {
					throw new Error("the starting insights are missing");
				}
				expect(
					(await send(first.base, "DELETE", `/api/insights/saved/${cost.id}`))
						.status,
				).toBe(204);
				expect(
					(
						await send(
							first.base,
							"PATCH",
							`/api/insights/saved/${failures.id}`,
							{ name: "Why runs fail" },
						)
					).status,
				).toBe(200);
			} finally {
				await first.stop();
			}
			const second = await serveHub(hub, databasePath);
			try {
				const names = (await savedList(second.base)).map((query) => query.name);
				expect(names).toEqual(["Why runs fail", ...startingNames.slice(2)]);
			} finally {
				await second.stop();
			}
		});
	});
});
