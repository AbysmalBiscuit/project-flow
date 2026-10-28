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
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

describe("factory cancels", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const cancelPath = `/runs/${running41.id}/cancel`;
	const stopped = <Row extends object>(row: Row) => ({
		...row,
		status: { kind: "failed", reason: "stopped" },
		ended_at: "2026-10-25T14:30:00+00:00",
	});

	/** Factories that report a run as running until one of them takes a cancel, and as stopped after. */
	function stopOnCancel() {
		let cancelled = false;
		return {
			runs:
				<Row extends object>(row: Row) =>
				() => ({ runs: [cancelled ? stopped(row) : row] }),
			cancel:
				<Row extends object>(row: Row) =>
				() => {
					cancelled = true;
					return stopped(row);
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

	function sendCancel(base: string) {
		return fetch(new URL(`/api/factory-runs/${running41?.id}/cancel`, base), {
			method: "POST",
		});
	}

	async function runStatus(base: string): Promise<string> {
		const response = await fetch(
			new URL(`/api/factory-runs/${running41?.id}`, base),
		);
		const run = (await response.json()) as RunDetail;
		return run.statusKind;
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a cancel of a run that a hub and its box report goes to the hub, and the run then reads as failed", async () => {
		const stop = stopOnCancel();
		const onBox = boxRow(running41, "running");
		const app = await servedRun(
			{
				...hub,
				"/runs": stop.runs(running41),
				[cancelPath]: stop.cancel(running41),
			},
			{
				...daemon,
				"/runs": stop.runs(onBox),
				[cancelPath]: stop.cancel(onBox),
			},
		);
		try {
			expect(await runStatus(app.base)).toBe("running");
			const response = await sendCancel(app.base);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ cancelled: true });
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${cancelPath}`,
					unix: null,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await runStatus(app.base)).toBe("failed");
		} finally {
			await app.stop();
		}
	});

	test("a cancel of a run that only a standalone factory reports goes to that factory, and the run then reads as failed", async () => {
		const stop = stopOnCancel();
		const onBox = boxRow(running41, "running");
		const app = await servedRun(
			{ ...hub, "/runs": { runs: [] } },
			{
				...daemon,
				"/runs": stop.runs(onBox),
				[cancelPath]: stop.cancel(onBox),
			},
		);
		try {
			expect(await runStatus(app.base)).toBe("running");
			const response = await sendCancel(app.base);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `http://localhost${cancelPath}`,
					unix: laptopSocket,
					method: "POST",
					body: "{}",
				},
			]);
			expect(await runStatus(app.base)).toBe("failed");
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory on a cancel gives the factory's reason", async () => {
		const app = await servedRun({
			...hub,
			[cancelPath]: Response.json(
				{ error: `run ${running41.id} has already ended` },
				{ status: 409 },
			),
		});
		try {
			const response = await sendCancel(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: `run ${running41.id} has already ended`,
			});
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory with no reason in its body gives a clear cancel error", async () => {
		const app = await servedRun({
			...hub,
			[cancelPath]: new Response(null, { status: 409 }),
		});
		try {
			const response = await sendCancel(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run has already ended",
			});
		} finally {
			await app.stop();
		}
	});
});
