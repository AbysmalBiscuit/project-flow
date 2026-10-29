import { describe, expect, test } from "bun:test";

import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	daemon,
	type FactoryRequest,
	hub,
	hubUrl,
} from "../support/factory.ts";
import { boxRow, factoryRunOf, overviewWhere, serveRuns } from "./_support.ts";

describe("factory steers", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const steerPath = `/runs/${running41.id}/steer`;
	const steer = { stage: "implement", text: "Use the v2 API", interrupt: true };
	const steered = { id: 1, run_id: running41.id, ...steer, sender: "lev" };

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

	function sendSteer(base: string) {
		return fetch(new URL(`/api/factory-runs/${running41?.id}/steer`, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(steer),
		});
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	const hubSteer = {
		url: `${hubUrl}${steerPath}`,
		unix: null,
		method: "POST",
		body: JSON.stringify({ ...steer, sender: "lev" }),
	};

	test("a steer sent through the API reaches the factory as one steer POST with Lev as the sender", async () => {
		const app = await servedRun({ ...hub, [steerPath]: steered });
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ steered: true });
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});

	test("a steer to a run that a hub and its box report goes to the hub, and the box gets no steer", async () => {
		const app = await servedRun(
			{ ...hub, [steerPath]: steered },
			{
				...daemon,
				"/runs": { runs: [boxRow(running41, "running")] },
				[steerPath]: steered,
			},
		);
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory on a steer gives the factory's reason", async () => {
		const app = await servedRun({
			...hub,
			[steerPath]: Response.json(
				{ error: `run ${running41.id} has already ended` },
				{ status: 409 },
			),
		});
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: `run ${running41.id} has already ended`,
			});
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});

	test("a 409 from the factory with no reason in its body gives a clear steer error", async () => {
		const app = await servedRun({
			...hub,
			[steerPath]: new Response(null, { status: 409 }),
		});
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "the run has ended, so it takes no steer",
			});
		} finally {
			await app.stop();
		}
	});
	test("a 502 from the factory with an error body on a steer gives the factory's reason", async () => {
		const reason = `box of run ${running41.id} did not answer`;
		const app = await servedRun({
			...hub,
			[steerPath]: Response.json({ error: reason }, { status: 502 }),
		});
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(502);
			expect(await response.json()).toEqual({ error: reason });
		} finally {
			await app.stop();
		}
	});

	test("a 502 from the factory with no reason in its body gives a clear steer error", async () => {
		const app = await servedRun({
			...hub,
			[steerPath]: new Response("bad gateway", { status: 502 }),
		});
		try {
			const response = await sendSteer(app.base);
			expect(response.status).toBe(502);
			expect(await response.json()).toEqual({
				error: "the factory did not take the steer",
			});
		} finally {
			await app.stop();
		}
	});
});
