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
