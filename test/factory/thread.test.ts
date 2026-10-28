import { describe, expect, test } from "bun:test";

import hubEvents from "../fixtures/factory-hub-events.json";
import hubRuns from "../fixtures/factory-hub-runs.json";
import answeredQuestions from "../fixtures/factory-run-questions-answered.json";
import runQuestions from "../fixtures/factory-run-questions.json";
import steerDelivered from "../fixtures/factory-steer-delivered.json";
import { EventFeed, hub } from "../support/factory.ts";
import {
	factoryRunOf,
	hubWith41,
	overviewWhere,
	serveRuns,
} from "./_support.ts";

describe("run thread", () => {
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
	const steerPath = `/runs/${running41.id}/steer`;
	const steer = steerDelivered.item.data;
	const steerMessage = {
		kind: "steer" as const,
		sender: steer.sender,
		text: steer.text,
		at: steer.delivered_at,
	};

	function post(base: string, path: string, body: unknown) {
		return fetch(new URL(path, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("the run gives its asks, answers and delivered steers as one thread in time order, with the sender of each", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{
				...hubWith41("blocked"),
				"/events": feed,
				[questionsPath]: runQuestions,
				[answerPath]: { ...question, answer: "Add the scope." },
			},
			[41],
		);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			app.advance(5 * 60_000);
			const answered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/questions/${question.id}/answer`,
				{ text: "Add the scope." },
			);
			expect(answered.status).toBe(200);
			feed.send(steerDelivered);
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 3,
			);
			expect(factoryRunOf(body, 41)?.thread).toEqual([
				{
					kind: "ask",
					sender: question.node_path,
					text: question.text,
					at: "2026-10-25T14:20:00.000Z",
				},
				{
					kind: "answer",
					sender: "lev",
					text: "Add the scope.",
					at: "2026-10-25T14:25:00.000Z",
				},
				steerMessage,
			]);
		} finally {
			await app.stop();
		}
	});

	test("a run that the app sees first after a restart gives its answered asks in the thread, with the answer, sender and time of each", async () => {
		const app = await serveRuns(
			{ ...hubWith41("running"), [questionsPath]: answeredQuestions },
			[41],
		);
		try {
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 4,
			);
			const [scope, review] = answeredQuestions.answered;
			if (scope === undefined || review === undefined) {
				throw new Error("the answered questions fixture lost an ask");
			}
			expect(factoryRunOf(body, 41)?.thread).toEqual([
				{
					kind: "ask",
					sender: scope.node_path,
					text: scope.text,
					at: "2026-10-25T14:25:00+00:00",
				},
				{
					kind: "answer",
					sender: "lev",
					text: "Add the scope.",
					at: "2026-10-25T14:25:00+00:00",
				},
				{
					kind: "ask",
					sender: review.node_path,
					text: review.text,
					at: "2026-10-25T14:40:00+00:00",
				},
				{
					kind: "answer",
					sender: "someone",
					text: "Yes, add one.",
					at: "2026-10-25T14:40:00+00:00",
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("an answer that Lev sends joins the thread once when the resumed run lists it as answered", async () => {
		let resumed = false;
		const [, ...rest] = hubRuns.runs;
		const app = await serveRuns(
			{
				...hub,
				"/runs": () => ({
					runs: [
						{
							...running41,
							status: { kind: resumed ? "running" : "blocked" },
						},
						...rest,
					],
				}),
				[questionsPath]: () => (resumed ? answeredQuestions : runQuestions),
				[answerPath]: () => {
					resumed = true;
					return { ...question, answer: "Add the scope." };
				},
			},
			[41],
		);
		try {
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.questions !== undefined,
			);
			const answered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/questions/${question.id}/answer`,
				{ text: "Add the scope." },
			);
			expect(answered.status).toBe(200);
			app.advance(60 * 60_000);
			const body = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.thread?.length === 4,
			);
			expect(
				factoryRunOf(body, 41)?.thread?.map(({ kind, sender, text }) => ({
					kind,
					sender,
					text,
				})),
			).toEqual([
				{ kind: "ask", sender: question.node_path, text: question.text },
				{ kind: "answer", sender: "lev", text: "Add the scope." },
				{
					kind: "ask",
					sender: "review/senior_question",
					text: "The review found no test for the scope check. Should the run add one?",
				},
				{ kind: "answer", sender: "someone", text: "Yes, add one." },
			]);
		} finally {
			await app.stop();
		}
	});

	test("a steer that Lev sends joins the thread once, when the factory reports it delivered", async () => {
		const feed = new EventFeed();
		const app = await serveRuns(
			{
				...hub,
				"/events": feed,
				[steerPath]: { id: steer.steer, run_id: running41.id, sender: "lev" },
			},
			[41],
		);
		try {
			await feed.connected(1);
			await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.statusKind === "running",
			);
			const steered = await post(
				app.base,
				`/api/factory-runs/${running41.id}/steer`,
				{ stage: "implement", text: steer.text, interrupt: steer.interrupt },
			);
			expect(steered.status).toBe(200);
			const sent = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41) !== undefined,
			);
			expect(factoryRunOf(sent, 41)?.thread).toBeUndefined();
			feed.send(steerDelivered);
			feed.send(steerDelivered);
			const [planStarted] = hubEvents;
			feed.send(planStarted);
			const delivered = await overviewWhere(
				app.base,
				(seen) => factoryRunOf(seen, 41)?.stage === "plan",
			);
			expect(factoryRunOf(delivered, 41)?.thread).toEqual([steerMessage]);
		} finally {
			await app.stop();
		}
	});
});
