import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runQuestions from "../fixtures/factory-run-questions.json";
import {
	type Answers,
	daemon,
	EventFeed,
	type FactoryRequest,
	hub,
	hubUrl,
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
