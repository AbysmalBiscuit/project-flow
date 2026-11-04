import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import hubRuns from "../fixtures/factory-hub-runs.json";
import { hub } from "../support/factory.ts";
import { answerWhere, serveHub } from "./_support.ts";

const idsSql = "select id from runs order by id";

const hubIds = hubRuns.runs.map((run) => [run.id]).toSorted();

test("the run history keeps a run that the factory no longer lists", async () => {
	const root = await mkdtemp(join(tmpdir(), "project-flow-history-"));
	const databasePath = join(root, "store.sqlite");
	try {
		const first = await serveHub(hub, databasePath);
		try {
			await answerWhere(first.base, idsSql, (count) => count === 4);
		} finally {
			await first.stop();
		}
		const [, ended, ...rest] = hubRuns.runs;
		const costed = {
			...ended,
			usage: {
				tokens: { input: 10, output: 5 },
				cost_usd: 9,
				duration_s: 60,
			},
		};
		const second = await serveHub(
			{ ...hub, "/runs": { runs: [costed, ...rest] } },
			databasePath,
		);
		try {
			await answerWhere(
				second.base,
				"select id from runs where cost_usd = 9",
				(count) => count === 1,
			);
			const answer = await answerWhere(second.base, idsSql, () => true);
			expect(answer.rows).toEqual(hubIds);
		} finally {
			await second.stop();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a restart with an empty store fills the run history again from the factories", async () => {
	const root = await mkdtemp(join(tmpdir(), "project-flow-history-"));
	const databasePath = join(root, "store.sqlite");
	try {
		const first = await serveHub(hub, databasePath);
		try {
			await answerWhere(first.base, idsSql, (count) => count === 4);
		} finally {
			await first.stop();
		}
		for (const suffix of ["", "-wal", "-shm"]) {
			await rm(`${databasePath}${suffix}`, { force: true });
		}
		const second = await serveHub(hub, databasePath);
		try {
			const refilled = await answerWhere(
				second.base,
				idsSql,
				(count) => count === 4,
			);
			expect(refilled.rows).toEqual(hubIds);
		} finally {
			await second.stop();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

const ended = hubRuns.runs.find((run) => run.ticket === "40");
if (ended === undefined) {
	throw new Error("the hub runs fixture lost the run of ticket 40");
}
const endedRun = ended;

/** The hub runs, less the run of ticket 40 once the hub takes `action` on it. */
function hubTaking(action: "delete" | "archive") {
	let taken = false;
	const archived = { ...endedRun, archived_at: "2026-10-25T15:00:00+00:00" };
	return {
		...hub,
		"/runs": () => ({
			runs: hubRuns.runs.flatMap((run) => {
				if (run.id !== endedRun.id || !taken) {
					return [run];
				}
				return action === "delete" ? [] : [archived];
			}),
		}),
		[`/runs/${endedRun.id}/${action}`]: () => {
			taken = true;
			return endedRun;
		},
	};
}

function take(base: string, action: "delete" | "archive") {
	return fetch(new URL(`/api/factory-runs/${endedRun.id}/${action}`, base), {
		method: "POST",
	});
}

const endedSql = `select id, archived_at from runs where id = '${endedRun.id}'`;

test("a delete of a run drops it from the run history", async () => {
	const app = await serveHub(hubTaking("delete"));
	try {
		await answerWhere(app.base, endedSql, (count) => count === 1);
		const response = await take(app.base, "delete");
		expect(response.status).toBe(200);
		const after = await answerWhere(app.base, endedSql, () => true);
		expect(after.rows).toEqual([]);
		const rest = await answerWhere(app.base, idsSql, () => true);
		expect(rest.rows).toEqual(hubIds.filter(([id]) => id !== endedRun.id));
	} finally {
		await app.stop();
	}
});

test("an archive of a run keeps it in the run history with its archive time", async () => {
	const app = await serveHub(hubTaking("archive"));
	try {
		await answerWhere(app.base, endedSql, (count) => count === 1);
		const response = await take(app.base, "archive");
		expect(response.status).toBe(200);
		const after = await answerWhere(app.base, endedSql, () => true);
		expect(after.rows).toEqual([[endedRun.id, "2026-10-25T15:00:00+00:00"]]);
	} finally {
		await app.stop();
	}
});
