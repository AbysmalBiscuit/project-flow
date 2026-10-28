import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, RunDetail } from "../../src/domain.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runQuestions from "../fixtures/factory-run-questions.json";
import {
	type Answers,
	daemon,
	EventFeed,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
} from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { openEventStream } from "../support/reads.ts";
import {
	boxRow,
	factoryRunOf,
	hubWith41,
	overviewEventWhere,
	overviewWhere,
	serveRuns,
} from "./_support.ts";

describe("factory questions", () => {
	const [running41] = hubRuns.runs;
	if (running41 === undefined) {
		throw new Error("the hub runs fixture lost a run");
	}
	const [question] = runQuestions.questions;
	if (question === undefined) {
		throw new Error("the run questions fixture lost its question");
	}
	const questionsPath = `/runs/${running41.id}/questions`;
	const answerPath = `${questionsPath}/${question.id}/answer`;
	const answered = { ...question, answer: "Add the scope." };

	function blockedHub(questions: unknown = runQuestions): Answers {
		return {
			...hubWith41("blocked"),
			[questionsPath]: questions,
			[answerPath]: answered,
		};
	}

	async function servedQuestions(
		hubAnswers: Answers,
		boxAnswers?: Answers,
	): Promise<Awaited<ReturnType<typeof serveRuns>>> {
		const app = await serveRuns(hubAnswers, [41], {}, boxAnswers);
		await overviewWhere(
			app.base,
			(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
		);
		return app;
	}

	async function needsYouOf(base: string): Promise<NeedsYouItem[]> {
		const response = await fetch(new URL("/api/needs-you", base));
		expect(response.status).toBe(200);
		return (await response.json()) as NeedsYouItem[];
	}

	function sendAnswer(base: string, questionId: string, text: string) {
		return fetch(
			new URL(
				`/api/factory-runs/${running41?.id}/questions/${questionId}/answer`,
				base,
			),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text }),
			},
		);
	}

	function posts(requests: FactoryRequest[]): FactoryRequest[] {
		return requests.filter((request) => request.method !== "GET");
	}

	test("a recorded open question gives an ask in Needs you with the factory as its source", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const asks = (await needsYouOf(app.base)).filter(
				(item) => item.key === `${repo}#41`,
			);
			expect(asks).toEqual([
				expect.objectContaining({
					reason: "ask",
					headline: question.text,
					question: question.text,
					answered: false,
					factoryAsk: {
						factory: "work hub",
						run: running41.id,
						question: String(question.id),
					},
				}),
			]);
		} finally {
			await app.stop();
		}
	});

	test("the newest run of a blocked ticket lists its open questions", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(factoryRunOf(body, 41)?.questions).toEqual([
				{ id: String(question.id), text: question.text },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a question that does not name Lev goes to the PM Bot and gives no ask", async () => {
		const app = await servedQuestions(
			blockedHub({
				questions: [
					{ ...question, text: "Senior, should the run keep the old branch?" },
				],
			}),
		);
		try {
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("an answer sent through the API reaches the factory as one answer POST", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			app.factories[hubUrl] = { ...hub, [answerPath]: answered };
			const response = await sendAnswer(
				app.base,
				String(question.id),
				"Add the scope.",
			);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${answerPath}`,
					unix: null,
					method: "POST",
					body: JSON.stringify({ text: "Add the scope.", sender: "lev" }),
				},
			]);
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("an answer to a question that the run does not wait on is refused and sends nothing", async () => {
		const app = await servedQuestions(blockedHub());
		try {
			const response = await sendAnswer(app.base, "8", "Add the scope.");
			expect(response.status).toBe(404);
			expect(posts(app.requests)).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("a stream frame that blocks a run reads its questions, and a frame that resumes it clears them", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{ ...hub, "/events": feed, [questionsPath]: runQuestions },
			[41],
		);
		const stream = openEventStream(app.base);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			await stream.ready;
			feed.send({ run_id: running41.id, status: { kind: "blocked" } });
			const blocked = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			expect(factoryRunOf(blocked, 41)).toMatchObject({
				statusKind: "blocked",
				questions: [{ id: String(question.id), text: question.text }],
			});
			feed.send({ run_id: running41.id, status: { kind: "running" } });
			const resumed = await overviewEventWhere(
				stream.events,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			expect(factoryRunOf(resumed, 41)?.questions).toBeUndefined();
			expect(
				(await needsYouOf(app.base)).filter(
					(item) => item.key === `${repo}#41`,
				),
			).toEqual([]);
		} finally {
			stream.close();
			await app.stop();
		}
	});

	test("an answer to a run that a hub and its box report goes to the hub, and the box gets no answer", async () => {
		const app = await servedQuestions(blockedHub(), {
			...daemon,
			"/runs": { runs: [boxRow(running41, "blocked")] },
			[questionsPath]: runQuestions,
			[answerPath]: answered,
		});
		try {
			const response = await sendAnswer(
				app.base,
				String(question.id),
				"Add the scope.",
			);
			expect(response.status).toBe(200);
			expect(posts(app.requests)).toEqual([
				{
					url: `${hubUrl}${answerPath}`,
					unix: null,
					method: "POST",
					body: JSON.stringify({ text: "Add the scope.", sender: "lev" }),
				},
			]);
		} finally {
			await app.stop();
		}
	});
});

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

	test("a 409 from the factory for an ended run gives a clear error", async () => {
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
				error: "the run has ended, so it takes no steer",
			});
			expect(posts(app.requests)).toEqual([hubSteer]);
		} finally {
			await app.stop();
		}
	});
});

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

	test("a 409 from the factory for an ended run gives a clear error", async () => {
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
				error: "the run has already ended",
			});
		} finally {
			await app.stop();
		}
	});
});

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

	test("a 409 from the factory for a run that is not blocked or failed gives a clear error", async () => {
		const app = await servedRun({
			...hub,
			"/runs": { runs: [failed41] },
			[resumePath]: Response.json(
				{ error: `run ${failed41.id} is running` },
				{ status: 409 },
			),
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
