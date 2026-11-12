import { describe, expect, test } from "bun:test";

import type {
	WorkflowDetail,
	WorkflowsPage,
} from "../../src/workflows-page.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import intakePackage from "../fixtures/factory-package-intake.json";
import standardPackage from "../fixtures/factory-package-standard.json";
import packageList from "../fixtures/factory-packages.json";
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

/** The version of the package that the factory serves, so a run of it matches its package. */
const newSha = standardPackage.version;
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

function turn(
	stage: string,
	input: number,
	output: number,
	costUsd: number,
	harness = "claude",
	model = "claude-opus-5-5",
) {
	return {
		node_path: stage,
		harness,
		model,
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
		{
			event: "stage.completed",
			stage: "post_pr/merge",
			at: "2026-10-25T13:40:00+00:00",
			duration: 30,
		},
	]),
	"/runs/run-40/turns": {
		turns: [
			turn("implement", 1_000, 100, 2.5),
			turn("review", 500, 50, 1.5, "codex", "gpt-6.1-sol"),
		],
	},
	"/runs/run-40/source": {
		entry: "pre_pr.dot",
		graphs: {
			"pre_pr.dot": `digraph PrePr {
  graph [label="Pre PR", rankdir=LR]
  start [shape=Mdiamond]
  exit [shape=Msquare]
  inputs [shape=parallelogram, label="Read inputs"]
  implement [shape=box, class="implementer",
    label="Implement", prompt="Write the \\"fix\\"."]
  review [shape=box, class="reviewer", label="Review"]
  post_pr [shape=house, class="manager", label="Post PR", prompt_file="post_pr.dot"]
  retry [shape=house, class="manager", label="Retry", prompt_file="post_pr.dot"]
  start -> inputs
  inputs -> implement [condition="preferred_label=build"]
  implement -> review -> post_pr -> exit
  review -> implement [label="changes"]
}
`,
			"post_pr.dot": `digraph PostPr {
  start [shape=Mdiamond]
  exit [shape=Msquare]
  merge [shape=box, class="receiver", label="Merge"]
  start -> merge -> exit
}
`,
			"unused.dot": `digraph Unused {
  start [shape=Mdiamond]
  start -> exit
}
`,
		},
	},
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
					firstRunAt: "2026-10-25T12:00:09+00:00",
					lastRunAt: "2026-10-25T13:05:20+00:00",
				},
				{
					package: "standard",
					sha: oldSha,
					runs: 1,
					mergeRate: 0,
					medianS: 3000,
					costPerRun: 1,
					firstRunAt: "2026-10-25T12:10:00+00:00",
					lastRunAt: "2026-10-25T12:10:00+00:00",
				},
				{
					package: "standard",
					sha: null,
					runs: 1,
					mergeRate: 0,
					medianS: 60,
					costPerRun: 0.5,
					firstRunAt: "2026-10-25T13:10:00+00:00",
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

	test("one package version gives the statistics of each top-level stage and its runs, newest first", async () => {
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

	test("one package version gives the graphs of its latest run, the entry graph and then each graph it calls, with the role of each node and the condition of each edge", async () => {
		const app = await serveHub();
		try {
			const detail = await readWhere<WorkflowDetail>(
				app.base,
				detailPath,
				(seen) => seen.graph !== null,
			);
			expect(detail.graph?.runId).toBe("run-40");
			expect(detail.roles).toBeNull();
			expect(detail.graph?.graphs.map((graph) => graph.name)).toEqual([
				"pre_pr.dot",
				"post_pr.dot",
			]);
			const [entry, postPr] = detail.graph?.graphs ?? [];
			const nodes = new Map(entry?.graph.nodes.map((node) => [node.id, node]));
			expect([...nodes.keys()]).toEqual([
				"start",
				"exit",
				"inputs",
				"implement",
				"review",
				"post_pr",
				"retry",
			]);
			expect(nodes.get("review")).toMatchObject({
				label: "Review",
				shape: "box",
				kind: "codergen",
				role: "reviewer",
			});
			expect(nodes.get("implement")?.label).toBe("Implement");
			expect(nodes.get("inputs")).toMatchObject({
				label: "Read inputs",
				kind: "tool",
			});
			expect(nodes.get("inputs")?.role).toBeUndefined();
			expect(nodes.get("start")?.kind).toBe("start");
			expect(entry?.graph.edges).toEqual([
				{ from: "start", to: "inputs" },
				{
					from: "inputs",
					to: "implement",
					condition: "preferred_label=build",
				},
				{ from: "implement", to: "review" },
				{ from: "review", to: "post_pr" },
				{ from: "post_pr", to: "exit" },
				{ from: "review", to: "implement", label: "changes" },
			]);
			expect(postPr?.graph.nodes.map((node) => node.role)).toEqual([
				undefined,
				undefined,
				"receiver",
			]);
		} finally {
			await app.stop();
		}
	});

	describe("with a factory that serves its packages", () => {
		const served: Answers = {
			...answers,
			"/packages": packageList,
			"/packages/standard": standardPackage,
			"/packages/intake": intakePackage,
		};

		test("a package with no run gets a card, and its detail gives each of its graphs, the entry graph first", async () => {
			const app = await serveHub(served);
			try {
				const page = await readWhere<WorkflowsPage>(
					app.base,
					"/api/workflows",
					(seen) =>
						seen.cards.some((card) => card.package === "intake") &&
						seen.cards.filter((card) => card.sha !== null).length === 3,
				);
				expect(
					page.cards.map((card) => [card.package, card.sha, card.runs]),
				).toEqual([
					["standard", newSha, 2],
					["standard", oldSha, 1],
					["intake", intakePackage.version, 0],
					["standard", null, 1],
				]);
				expect(page.cards[2]).toEqual({
					package: "intake",
					sha: intakePackage.version,
					runs: 0,
					mergeRate: null,
					medianS: null,
					costPerRun: null,
					firstRunAt: null,
					lastRunAt: null,
				});
				const intake = await readWhere<WorkflowDetail>(
					app.base,
					`/api/workflows/intake?sha=${intakePackage.version}`,
					(seen) => seen.graph !== null,
				);
				expect(intake.runs).toEqual([]);
				expect(intake.graph?.runId).toBeUndefined();
				expect(intake.graph?.graphs.map((graph) => graph.name)).toEqual([
					"intake.dot",
					"reporting.dot",
				]);
				const interview = intake.graph?.graphs[0]?.graph.nodes.find(
					(node) => node.id === "interview",
				);
				expect(interview).toMatchObject({
					role: "interviewer",
					kind: "codergen",
				});
				const standard = await readWhere<WorkflowDetail>(
					app.base,
					detailPath,
					(seen) => seen.graph !== null,
				);
				const names = standard.graph?.graphs.map((graph) => graph.name) ?? [];
				expect(names.slice(0, 7)).toEqual([
					"pre-pr.dot",
					"rebase.dot",
					"conceptual.dot",
					"rebase-push.dot",
					"fix-push.dot",
					"post-pr.dot",
					"report.dot",
				]);
				expect(names.toSorted()).toEqual(
					Object.keys(standardPackage.graphs).toSorted(),
				);
			} finally {
				await app.stop();
			}
		});

		test("the roles of a package version give the harness and model of its turns, else of the package, the stages of each role and its share of the turn cost", async () => {
			const app = await serveHub(served);
			try {
				const detail = await readWhere<WorkflowDetail>(
					app.base,
					detailPath,
					(seen) =>
						seen.roles?.some((role) => role.costShare !== null) ?? false,
				);
				const roles = new Map(detail.roles?.map((role) => [role.role, role]));
				expect([...roles.keys()]).toEqual(
					standardPackage.roles.map((role) => role.name),
				);
				expect(roles.get("implementer")).toMatchObject({
					harnesses: ["claude"],
					models: ["claude-opus-5-5"],
					costShare: 0.75,
				});
				expect(roles.get("implementer")?.stages.slice(0, 3)).toEqual([
					"implement",
					"apply",
					"repush",
				]);
				expect(roles.get("reviewer")).toEqual({
					role: "reviewer",
					harnesses: ["codex"],
					models: ["gpt-6.1-sol"],
					stages: ["review"],
					costShare: 0.25,
				});
				expect(roles.get("verifier")).toEqual({
					role: "verifier",
					harnesses: ["codex"],
					models: ["gpt-6.1-sol"],
					stages: ["verify", "reverify"],
					costShare: 0,
				});
			} finally {
				await app.stop();
			}
		});

		test("a version that no factory lists takes its roles from the listed package of the same name, and keeps the graphs of its runs", async () => {
			const app = await serveHub(served);
			try {
				const detail = await readWhere<WorkflowDetail>(
					app.base,
					`/api/workflows/standard?sha=${oldSha}`,
					(seen) => seen.roles !== null && seen.runs.length === 1,
				);
				expect(detail.graph).toBeNull();
				const roles = new Map(detail.roles?.map((role) => [role.role, role]));
				expect([...roles.keys()]).toEqual(
					standardPackage.roles.map((role) => role.name),
				);
				expect(roles.get("implementer")).toMatchObject({
					harnesses: ["claude"],
					models: ["claude-opus-5-5"],
					costShare: 1,
				});
				expect(roles.get("reviewer")?.costShare).toBe(0);
			} finally {
				await app.stop();
			}
		});
	});
});
