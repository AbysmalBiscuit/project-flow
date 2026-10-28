import { describe, expect, test } from "bun:test";

import type { RunDetail } from "../../src/domain.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	daemon,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
} from "../support/factory.ts";
import { factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

describe("factory resumes and restarts", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const failed41 = {
		...running41,
		status: { kind: "failed", reason: "stage review failed" },
		ended_at: "2026-10-25T14:30:00+00:00",
		restarted_from: null,
	};
	const restarted41 = {
		...running41,
		id: "20261025-143500-f7a8",
		status: { kind: "submitted", reason: null },
		submitted_at: "2026-10-25T14:35:00+00:00",
		started_at: null,
		machine: null,
		restarted_from: failed41.id,
	};
	/** The row of a run as the box that does it reports it. */
	const onBox = (row: object, kind: string) => ({
		...row,
		status: { kind, reason: null },
		source: null,
		rule: null,
		machine: "local",
	});
	const resumePath = `/runs/${failed41.id}/resume`;
	const restartPath = `/runs/${failed41.id}/restart`;

	/** A factory that reports `rows` until it takes a write, and `after` then. */
	function changeOnWrite(rows: object[], after: object[], answer: object) {
		let written = false;
		return {
			runs: () => ({ runs: written ? after : rows }),
			write: () => {
				written = true;
				return answer;
			},
		};
	}

	async function servedRun(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41) !== undefined,
		);
		return app;
	}

	function send(base: string, action: "resume" | "restart") {
		return fetch(new URL(`/api/factory-runs/${failed41.id}/${action}`, base), {
			method: "POST",
		});
	}

	async function detailOf(base: string, id: string): Promise<RunDetail> {
		const response = await fetch(new URL(`/api/factory-runs/${id}`, base));
		return (await response.json()) as RunDetail;
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a resume of a run that a hub and its box report goes to the hub and keeps the run id", async () => {
		const resumed = {
			...failed41,
			status: { kind: "submitted", reason: null },
		};
		let forwarded = false;
		const app = await servedRun(
			{
				...hub,
				"/runs": () => ({ runs: [forwarded ? resumed : failed41] }),
				[resumePath]: () => {
					forwarded = true;
					return resumed;
				},
			},
			{
				...daemon,
				"/runs": () => ({
					runs: [
						forwarded ? onBox(resumed, "running") : onBox(failed41, "failed"),
					],
				}),
			},
		);
		try {
			expect((await detailOf(app.base, failed41.id)).statusKind).toBe("failed");
			const response = await send(app.base, "resume");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: failed41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${resumePath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect((await detailOf(app.base, failed41.id)).statusKind).toBe(
				"running",
			);
		} finally {
			await app.stop();
		}
	});

	test("a restart of a run that a hub and its box report goes to the hub, gives the new run id, and the new run names the old run", async () => {
		const hubSide = changeOnWrite(
			[failed41],
			[restarted41, failed41],
			Response.json(restarted41, { status: 201 }),
		);
		const app = await servedRun(
			{ ...hub, "/runs": hubSide.runs, [restartPath]: hubSide.write },
			{ ...daemon, "/runs": { runs: [onBox(failed41, "failed")] } },
		);
		try {
			const response = await send(app.base, "restart");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: restarted41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${restartPath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			const fresh = await detailOf(app.base, restarted41.id);
			expect(fresh.statusKind).toBe("queued");
			expect(fresh.restartedFrom).toBe(failed41.id);
			expect(
				(await detailOf(app.base, failed41.id)).restartedFrom,
			).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("a restart of a run that only a standalone factory reports goes to that factory", async () => {
		const oldOnBox = onBox(failed41, "failed");
		const freshOnBox = onBox(restarted41, "submitted");
		const boxSide = changeOnWrite(
			[oldOnBox],
			[freshOnBox, oldOnBox],
			Response.json(freshOnBox, { status: 201 }),
		);
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{ ...daemon, "/runs": boxSide.runs, [restartPath]: boxSide.write },
		);
		try {
			const response = await send(app.base, "restart");
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ id: restarted41.id });
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${restartPath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect((await detailOf(app.base, restarted41.id)).restartedFrom).toBe(
				failed41.id,
			);
		} finally {
			await app.stop();
		}
	});

	test.each(["resume", "restart"] as const)(
		"a 409 from the factory on a %s of a failed run gives the factory's reason",
		async (action) => {
			const reason = `run 7f3c9a1e of ticket 41 is open; stop it before ${action} run ${failed41.id}`;
			const app = await servedRun({
				...hub,
				"/runs": { runs: [failed41] },
				[action === "resume" ? resumePath : restartPath]: Response.json(
					{ error: reason },
					{ status: 409 },
				),
			});
			try {
				const response = await send(app.base, action);
				expect(response.status).toBe(409);
				expect(await response.json()).toEqual({ error: reason });
			} finally {
				await app.stop();
			}
		},
	);

	test("a 409 from the factory with no reason in its body gives a clear error", async () => {
		const app = await servedRun({
			...hub,
			"/runs": { runs: [failed41] },
			[resumePath]: new Response(null, { status: 409 }),
		});
		try {
			const response = await send(app.base, "resume");
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run is not blocked or failed",
			});
		} finally {
			await app.stop();
		}
	});
});
