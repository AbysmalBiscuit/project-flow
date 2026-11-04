import { describe, expect, test } from "bun:test";

import type {
	WorkflowDetail,
	WorkflowsPage,
} from "../../src/workflows-page.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import runGraph from "../fixtures/factory-run-graph.json";
import {
	type Answers,
	eventLog,
	factoryFetch,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";

const [running41] = hubRuns.runs;
if (running41 === undefined) {
	throw new Error("the hub runs fixture lost a run");
}

const newSha =
	"3f9c1a2e8d7b6c5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a";
const oldSha =
	"9b2c7710aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff";

function endedRun(
	id: string,
	ticket: string,
	status: { kind: "succeeded" | "failed"; reason: string | null },
	startedAt: string,
	endedAt: string,
	costUsd: number,
) {
	return {
		...running41,
		id,
		ticket,
		package: "standard",
		status,
		started_at: startedAt,
		ended_at: endedAt,
		usage: {
			tokens: { input: 1_000, output: 100 },
			cost_usd: costUsd,
			duration_s: 600,
		},
	};
}

const merged40 = endedRun(
	"run-40",
	"40",
	{ kind: "succeeded", reason: null },
	"2026-10-25T13:05:20+00:00",
	"2026-10-25T13:48:02+00:00",
	4,
);
const failed39 = endedRun(
	"run-39",
	"39",
	{ kind: "failed", reason: "stage review failed" },
	"2026-10-25T12:00:09+00:00",
	"2026-10-25T12:30:00+00:00",
	2,
);
const old38 = endedRun(
	"run-38",
	"38",
	{ kind: "succeeded", reason: null },
	"2026-10-25T12:10:00+00:00",
	"2026-10-25T13:00:00+00:00",
	1,
);
/** A run whose event log lost its `workflow.started` event, so its sha is unknown. */
const unknown37 = endedRun(
	"run-37",
	"37",
	{ kind: "failed", reason: "network" },
	"2026-10-25T13:10:00+00:00",
	"2026-10-25T13:11:00+00:00",
	0.5,
);

/** The `workflow.started` event of a run, as a factory records it, then its stage events. */
function runLog(
	runId: string,
	sha: string,
	stages: { event: string; stage: string; at: string; duration: number }[],
) {
	return eventLog(runId, [
		{
			event: "workflow.started",
			stage: "",
			at: "2026-10-25T12:00:00+00:00",
			data: {
				id: runId,
				issue: "40",
				machine: "box-a",
				name: "PrePr",
				package: { name: "standard", sha256: sha },
				repo: "acme/widget",
			},
		},
		{
			event: "workflow.started",
			stage: "conceptual",
			at: "2026-10-25T12:00:01+00:00",
			data: { id: runId, name: "Conceptual" },
		},
		...stages.map((item) => ({
			event: item.event,
			stage: item.stage,
			at: item.at,
			data: { name: item.stage, duration: item.duration },
		})),
	]);
}

function turn(stage: string, input: number, output: number, costUsd: number) {
	return {
		node_path: stage,
		session: "5b1f7c2e-0d4a-4c1e-9b61-2f7d3e8a9c10",
		tools: {},
		tokens: { input, output },
		cost_usd: costUsd,
		duration_s: 60,
	};
}

const answers: Answers = {
	...hub,
	"/sources": { sources: [] },
	"/runs": { runs: [unknown37, merged40, failed39, old38] },
	"/runs/run-37/events": eventLog("run-37", []),
	"/runs/run-37/turns": { turns: [] },
	"/runs/run-40": {
		...merged40,
		outputs: { merge_sha: "4f1c2a9e" },
		pr: {
			owner: "acme",
			repo: "widget",
			number: 72,
			url: "https://github.com/acme/widget/pull/72",
		},
	},
	"/runs/run-40/events": runLog("run-40", newSha, [
		{
			event: "stage.completed",
			stage: "implement",
			at: "2026-10-25T13:15:00+00:00",
			duration: 600,
		},
		{
			event: "stage.completed",
			stage: "review",
			at: "2026-10-25T13:20:00+00:00",
			duration: 300,
		},
		{
			event: "stage.completed",
			stage: "review",
			at: "2026-10-25T13:30:00+00:00",
			duration: 240,
		},
	]),
	"/runs/run-40/turns": {
		turns: [turn("implement", 1_000, 100, 2.5), turn("review", 500, 50, 1.5)],
	},
	"/runs/run-40/graph": runGraph,
	"/runs/run-39/events": runLog("run-39", newSha, [
		{
			event: "stage.completed",
			stage: "implement",
			at: "2026-10-25T12:15:00+00:00",
			duration: 900,
		},
		{
			event: "stage.failed",
			stage: "review",
			at: "2026-10-25T12:29:00+00:00",
			duration: 120,
		},
	]),
	"/runs/run-39/turns": { turns: [turn("implement", 2_000, 200, 2)] },
	"/runs/run-38/events": runLog("run-38", oldSha, [
		{
			event: "stage.completed",
			stage: "implement",
			at: "2026-10-25T12:30:00+00:00",
			duration: 1_200,
		},
	]),
	"/runs/run-38/turns": { turns: [turn("implement", 3_000, 300, 1)] },
};

async function serveHub(hubAnswers: Answers = answers) {
	return serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: hubAnswers }, []),
		{ env: { GITHUB_TOKEN: "recorded-token" } },
	);
}

/** The JSON answer of `path`, once it meets `accept`. */
async function readWhere<T>(
	base: string,
	path: string,
	accept: (body: T) => boolean,
): Promise<T> {
	while (true) {
		const response = await fetch(new URL(path, base));
		if (response.status === 200) {
			const body = (await response.json()) as T;
			if (accept(body)) {
				return body;
			}
		}
		await Bun.sleep(20);
	}
}

const detailPath = `/api/workflows/standard?sha=${newSha}`;

describe("the Workflows tab", () => {
	test("runs of two versions of one package give two cards with their counts, merge rate, median duration and cost, and a run with no sha goes last", async () => {
		const app = await serveHub();
		try {
			const page = await readWhere<WorkflowsPage>(
				app.base,
				"/api/workflows",
				(seen) =>
					seen.cards.filter((card) => card.sha !== null).length === 2 &&
					seen.cards.some((card) => card.mergeRate === 0.5),
			);
			expect(page.cards).toEqual([
				{
					package: "standard",
					sha: newSha,
					runs: 2,
					mergeRate: 0.5,
					medianS: 2176.5,
					costPerRun: 3,
					lastRunAt: "2026-10-25T13:05:20+00:00",
				},
				{
					package: "standard",
					sha: oldSha,
					runs: 1,
					mergeRate: 0,
					medianS: 3000,
					costPerRun: 1,
					lastRunAt: "2026-10-25T12:10:00+00:00",
				},
				{
					package: "standard",
					sha: null,
					runs: 1,
					mergeRate: 0,
					medianS: 60,
					costPerRun: 0.5,
					lastRunAt: "2026-10-25T13:10:00+00:00",
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("until the first poll after a start ends, each card shows no merge rate and says that it reads the runs", async () => {
		const pull40 = Promise.withResolvers<void>();
		const app = await serveHub({
			...answers,
			"/runs/run-40": async () => {
				await pull40.promise;
				return answers["/runs/run-40"];
			},
		});
		try {
			const reading = await readWhere<WorkflowsPage>(
				app.base,
				"/api/workflows",
				(seen) => seen.cards.filter((card) => card.sha !== null).length === 2,
			);
			expect(reading.reading).toBe(true);
			expect(reading.cards.map((card) => card.mergeRate)).toEqual([
				null,
				null,
				null,
			]);
			pull40.resolve();
			const read = await readWhere<WorkflowsPage>(
				app.base,
				"/api/workflows",
				(seen) => !seen.reading,
			);
			expect(read.cards.map((card) => card.mergeRate)).toEqual([0.5, 0, 0]);
		} finally {
			pull40.resolve();
			await app.stop();
		}
	});

	test("one package version gives the statistics of each stage and its runs, newest first", async () => {
		const app = await serveHub();
		try {
			const detail = await readWhere<WorkflowDetail>(
				app.base,
				detailPath,
				(seen) =>
					seen.stages.length === 2 &&
					seen.stages.every((stage) => stage.costPerRun !== null) &&
					seen.runs.some((run) => run.result === "merged"),
			);
			expect(detail.stages).toEqual([
				{
					stage: "implement",
					visitsPerRun: 1,
					failRate: 0,
					p50S: 600,
					p95S: 900,
					tokensPerRun: 1_650,
					costPerRun: 2.25,
				},
				{
					stage: "review",
					visitsPerRun: 1.5,
					failRate: 1 / 3,
					p50S: 240,
					p95S: 300,
					tokensPerRun: 275,
					costPerRun: 0.75,
				},
			]);
			expect(detail.runs).toEqual([
				{
					id: "run-40",
					key: "acme/widget#40",
					status: "succeeded",
					result: "merged",
					factory: "work hub",
					durationS: 2562,
					rounds: 2,
					pull: { number: 72, url: "https://github.com/acme/widget/pull/72" },
					costUsd: 4,
				},
				{
					id: "run-39",
					key: "acme/widget#39",
					status: "failed",
					result: "failed",
					factory: "work hub",
					durationS: 1791,
					rounds: 1,
					costUsd: 2,
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("one package version gives the graph of its latest run, with the role of each node and the condition of each edge", async () => {
		const app = await serveHub();
		try {
			const detail = await readWhere<WorkflowDetail>(
				app.base,
				detailPath,
				(seen) => seen.graph !== null,
			);
			expect(detail.graph?.runId).toBe("run-40");
			const nodes = new Map(
				detail.graph?.graph.nodes.map((node) => [node.id, node]),
			);
			expect(nodes.get("review")).toMatchObject({
				label: "Review",
				shape: "box",
				kind: "codergen",
				role: "reviewer",
			});
			expect(nodes.get("implement")?.role).toBe("implementer");
			expect(nodes.get("inputs")?.role).toBeUndefined();
			expect(nodes.size).toBe(runGraph.nodes.length);
			expect(detail.graph?.graph.edges).toContainEqual({
				from: "inputs",
				to: "implement",
				condition: "preferred_label=build",
			});
		} finally {
			await app.stop();
		}
	});
});
