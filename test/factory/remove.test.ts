import { describe, expect, test } from "bun:test";

import type { RunListRow } from "../../src/run-list.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	daemon,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
} from "../support/factory.ts";
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

const found40 = hubRuns.runs.find((row) => row.ticket === "40");
if (found40 === undefined) {
	throw new Error("the hub runs fixture lost the run of ticket 40");
}
const succeeded40 = found40;
const deletePath = `/runs/${succeeded40.id}/delete`;
const archivePath = `/runs/${succeeded40.id}/archive`;
const archivedAt = "2026-10-25T15:00:00+00:00";

/** A factory that reports `row` until it takes the write, and `after` then. */
function changeOnWrite(row: object, after: object[]) {
	let written = false;
	return {
		runs: () => ({ runs: written ? after : [row] }),
		write: () => {
			written = true;
			return row;
		},
	};
}

async function servedRun(
	hubAnswers: Answers,
	boxAnswers?: Answers,
): Promise<Awaited<ReturnType<typeof serveRuns>>> {
	const app = await serveRuns(hubAnswers, [40], {}, boxAnswers);
	await overviewWhere(app.base, (seen) => factoryRunOf(seen, 40) !== undefined);
	return app;
}

function send(base: string, action: "delete" | "archive") {
	return fetch(
		new URL(`/api/factory-runs/${succeeded40?.id}/${action}`, base),
		{ method: "POST" },
	);
}

async function listed(base: string): Promise<RunListRow[]> {
	const response = await fetch(new URL("/api/factory-runs", base));
	return (await response.json()) as RunListRow[];
}

function posts(requests: FactoryRequest[]): FactoryRequest[] {
	return requests.filter((request) => request.method !== "GET");
}

describe("factory deletes", () => {
	test("a delete of a run that a hub and its box report goes to the hub, and the run then leaves the Runs list", async () => {
		// The hub deletes the run on its box too, so the box drops its row with the hub.
		const hubSide = changeOnWrite(succeeded40, []);
		const onBox = boxRow(succeeded40, "succeeded");
		const app = await servedRun(
			{ ...hub, "/runs": hubSide.runs, [deletePath]: hubSide.write },
			{
				...daemon,
				"/runs": () => ({
					runs: hubSide.runs().runs.length === 0 ? [] : [onBox],
				}),
				[deletePath]: onBox,
			},
		);
		try {
			expect((await listed(app.base)).map((row) => row.id)).toEqual([
				succeeded40.id,
			]);
			const response = await send(app.base, "delete");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ deleted: true });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${deletePath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await listed(app.base)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a delete of a run that only a standalone factory reports goes to that factory, and the run then leaves the Runs list", async () => {
		const boxSide = changeOnWrite(boxRow(succeeded40, "succeeded"), []);
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{ ...daemon, "/runs": boxSide.runs, [deletePath]: boxSide.write },
		);
		try {
			const response = await send(app.base, "delete");
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${deletePath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await listed(app.base)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory gives its reason, and the run stays", async () => {
		const reason = `run ${succeeded40.id} has an open PR; archive it instead`;
		const app = await servedRun({
			...hub,
			[deletePath]: Response.json({ error: reason }, { status: 409 }),
		});
		try {
			const response = await send(app.base, "delete");
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: reason });
			expect(
				(await listed(app.base)).some((row) => row.id === succeeded40.id),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a delete of a run that no factory reports gives 404 and sends nothing", async () => {
		const app = await servedRun(hub);
		try {
			const response = await fetch(
				new URL("/api/factory-runs/no-such-run/delete", app.base),
				{ method: "POST" },
			);
			expect(response.status).toBe(404);
			expect(posts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});
});

describe("factory archives", () => {
	test("the app reads the archived runs too, and an archived run stays in the Runs list marked archived and stays the run of its ticket", async () => {
		const hubSide = changeOnWrite(succeeded40, [
			{ ...succeeded40, archived_at: archivedAt },
		]);
		const app = await servedRun({
			...hub,
			"/runs": hubSide.runs,
			[archivePath]: hubSide.write,
		});
		try {
			expect((await listed(app.base))[0]?.archivedAt).toBeUndefined();
			const response = await send(app.base, "archive");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ archived: true });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${archivePath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect(
				app.requests.some(
					(request) =>
						request.method === "GET" &&
						request.url === `${hubUrl}/runs?archived=1`,
				),
			).toBe(true);
			expect(
				(await listed(app.base)).map((row) => [row.id, row.archivedAt]),
			).toEqual([[succeeded40.id, archivedAt]]);
			const seen = await overviewWhere(app.base, () => true);
			expect(factoryRunOf(seen, 40)?.id).toBe(succeeded40.id);
		} finally {
			await app.stop();
		}
	});

	test("an archive of a run that only a standalone factory reports goes to that factory", async () => {
		const onBox = boxRow(succeeded40, "succeeded");
		const boxSide = changeOnWrite(onBox, [
			{ ...onBox, archived_at: archivedAt },
		]);
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{ ...daemon, "/runs": boxSide.runs, [archivePath]: boxSide.write },
		);
		try {
			const response = await send(app.base, "archive");
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${archivePath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect((await listed(app.base))[0]?.archivedAt).toBe(archivedAt);
		} finally {
			await app.stop();
		}
	});
});
