import { expect, test } from "bun:test";

import type {
	RunVerification,
	VerificationPage,
} from "../../src/verification-page.ts";
import hubRuns from "../fixtures/factory-hub-runs.json";
import twoRounds from "../fixtures/factory-run-verification.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";

function runOf(ticket: string) {
	const found = hubRuns.runs.find((run) => run.ticket === ticket);
	if (found === undefined) {
		throw new Error(`the hub runs fixture lost the run of ticket ${ticket}`);
	}
	return found;
}

const failedRun = runOf("39");
const succeededRun = runOf("40");
const runningRun = runOf("41");

/** One round of run 39: a rejected item, a failed gate check, a high FAIL line and a failed CI proof. */
const oneRound = {
	stages: [
		{
			node_path: "verify",
			visit: 1,
			attempt: 1,
			stage: "verify@v1.a1",
			round: 1,
			verdicts: [
				{
					number: 1,
					text: "The widget list loads.",
					verdict: "verified",
					reason: "",
				},
				{
					number: 2,
					text: "The widget list pages.",
					verdict: "rejected",
					reason: "The proof does not show  the behaviour (widget#39).",
				},
			],
			review_check: null,
			gate: null,
			gate_checks: [
				{
					name: "pr repro",
					result: "failed",
					output: "no repro test in the diff",
				},
			],
			ci: null,
		},
		{
			node_path: "check",
			visit: 1,
			attempt: 1,
			stage: "check@v1.a1",
			round: 1,
			verdicts: [
				{
					number: 1,
					text: "The widget list loads.",
					verdict: "verified",
					reason: "",
				},
				{
					number: 2,
					text: "The widget list pages.",
					verdict: "rejected",
					reason: "The proof does not show  the behaviour (widget#39).",
				},
			],
			review_check: [
				{
					kind: "FAIL",
					severity: "high",
					path: "src/widgets.ts",
					line: 10,
					text: "The test sits below the HTTP seam.",
				},
			],
			gate: null,
			gate_checks: null,
			ci: null,
		},
		{
			node_path: "post_pr/verify",
			visit: 1,
			attempt: 1,
			stage: "post_pr@v1.a1/child/verify@v1.a1",
			round: 1,
			verdicts: null,
			review_check: null,
			gate: null,
			gate_checks: null,
			ci: {
				head: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c",
				verdict: "failed",
				line: "VERIFY-HEAD: failed check 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c 1",
				tasks: [{ name: "check", result: "failed" }],
				checks: [],
			},
		},
	],
};

const recorded: Answers = {
	...hub,
	[`/runs/${succeededRun.id}/verification`]: twoRounds,
	[`/runs/${failedRun.id}/verification`]: oneRound,
};

async function serveHub(answers: Answers) {
	const requests: FactoryRequest[] = [];
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			now: () => new Date("2026-10-26T00:00:00Z"),
		},
	);
	return {
		...app,
		paths: () => requests.map((request) => new URL(request.url).pathname),
	};
}

async function readJson<T>(base: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, base));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

async function pageWhere(
	base: string,
	accept: (page: VerificationPage) => boolean,
): Promise<VerificationPage> {
	while (true) {
		const page = await readJson<VerificationPage>(base, "/api/verification");
		if (accept(page)) {
			return page;
		}
		await Bun.sleep(20);
	}
}

test("the record of a run with two rounds gives each round's verdicts, review check lines and gates", async () => {
	const app = await serveHub(recorded);
	try {
		await pageWhere(app.base, (page) => page.runs.length === 2);
		const run = await readJson<RunVerification>(
			app.base,
			`/api/verification/runs/${succeededRun.id}`,
		);
		expect(run.notServed).toBe(false);
		expect(run.ticket).toBe("acme/widget#40");
		expect(run.rounds.map((round) => round.round)).toEqual([1, 2]);
		const [first, second] = run.rounds;
		expect(first?.doneWhen.map((item) => [item.number, item.verdict])).toEqual([
			[1, "verified"],
			[2, "rejected"],
			[3, "verified"],
			[4, "verified"],
		]);
		expect(first?.doneWhen[1]?.reason).toBe(
			"The proof does not show the behaviour (#860).",
		);
		expect(first?.reviewCheck).toEqual([
			{
				state: "fixed",
				severity: "medium",
				path: "src/verification-page.ts",
				line: 397,
				text: "The pass rate counts a skipped check as a failure.",
			},
			{
				state: "kept",
				severity: "low",
				path: "src/run-history.ts",
				line: 173,
				text: "The verdicts view repeats the round of each stage.",
			},
		]);
		expect(first?.gates).toEqual([
			{ name: "pr repro", passed: true, result: "passed", detail: null },
			{
				name: "pr weakened-tests",
				passed: true,
				result: "passed",
				detail: null,
			},
			{ name: "gate", passed: true, result: "success", detail: "below" },
		]);
		expect(second?.doneWhen.every((item) => item.verdict === "verified")).toBe(
			true,
		);
		expect(second?.reviewCheck.map((line) => [line.state, line.path])).toEqual([
			["kept", "README.md"],
			["kept", "src/run-history.ts"],
		]);
		expect(second?.gates.slice(2)).toEqual([
			{
				name: "post_pr/gate",
				passed: true,
				result: "success",
				detail: "passed",
			},
			{
				name: "CI proof at 57a273a",
				passed: true,
				result: "passed",
				detail: "2 of 2 checks",
			},
		]);
	} finally {
		await app.stop();
	}
});

test("the records of several runs give the tiles, the check pass rates and the rejection reasons", async () => {
	const app = await serveHub(recorded);
	try {
		const page = await pageWhere(app.base, (found) => found.runs.length === 2);
		expect(page.notServed).toEqual([]);
		expect(page.runs.map((run) => run.id)).toEqual([
			succeededRun.id,
			failedRun.id,
		]);
		expect(page.tiles).toEqual({
			firstRound: { verified: 4, items: 6 },
			rejected: {
				items: 2,
				topReason: "The proof does not show the behaviour.",
			},
			failLines: { lines: 2, high: 1, runs: 2 },
			ci: { passed: 1, firstPush: 1, runs: 2 },
		});
		expect(page.reasons).toEqual([
			{ reason: "The proof does not show the behaviour.", items: 2 },
		]);
		expect(
			page.checks.map((check) => [
				check.kind,
				check.name,
				check.passed,
				check.total,
				check.last,
				check.topFailure,
			]),
		).toEqual([
			[
				"verifier",
				"Done-when verdicts",
				1,
				3,
				[false, false, true],
				"The proof does not show the behaviour.",
			],
			[
				"review",
				"Review check",
				2,
				4,
				[false, false, true, true],
				"The pass rate counts a skipped check as a failure.",
			],
			["gate", "gate", 1, 1, [true], null],
			["gate", "post_pr/gate", 1, 1, [true], null],
			[
				"gate check",
				"pr repro",
				2,
				3,
				[false, true, true],
				"no repro test in the diff",
			],
			["gate check", "pr weakened-tests", 2, 2, [true, true], null],
			[
				"ci",
				"CI proof",
				1,
				2,
				[false, true],
				"VERIFY-HEAD: failed check 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c 1",
			],
			["ci", "check", 1, 2, [false, true], "failed"],
			["ci", "test-isolated", 1, 1, [true], null],
		]);
	} finally {
		await app.stop();
	}
});

test("the record of each ended run is read once, and a live run's record is not stored", async () => {
	const app = await serveHub(recorded);
	try {
		await pageWhere(app.base, (page) => page.runs.length === 2);
		await readJson<RunVerification>(
			app.base,
			`/api/verification/runs/${succeededRun.id}`,
		);
		await readJson<VerificationPage>(app.base, "/api/verification");
		const reads = (runId: string) =>
			app.paths().filter((path) => path === `/runs/${runId}/verification`);
		expect(reads(succeededRun.id)).toHaveLength(1);
		expect(reads(failedRun.id)).toHaveLength(1);
		expect(reads(runningRun.id)).toEqual([]);
	} finally {
		await app.stop();
	}
});

test("a factory with no verification route gets the not served note", async () => {
	const app = await serveHub(hub);
	try {
		const page = await pageWhere(
			app.base,
			(found) => found.notServed.length > 0,
		);
		expect(page.notServed).toEqual(["work hub"]);
		expect(page.runs).toEqual([]);
		const run = await readJson<RunVerification>(
			app.base,
			`/api/verification/runs/${succeededRun.id}`,
		);
		expect(run.notServed).toBe(true);
		expect(run.rounds).toEqual([]);
	} finally {
		await app.stop();
	}
});

test("Insights queries the verdicts of each stored record", async () => {
	const app = await serveHub(recorded);
	try {
		await pageWhere(app.base, (page) => page.runs.length === 2);
		const response = await fetch(new URL("/api/insights/query", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				sql: "select run_id, round, stage, number, verdict from verdicts where verdict = 'rejected' order by run_id, stage",
			}),
		});
		expect(response.status).toBe(200);
		const answer = (await response.json()) as { rows: unknown[][] };
		expect(answer.rows).toEqual([
			[failedRun.id, 1, "check@v1.a1", 2, "rejected"],
			[failedRun.id, 1, "verify@v1.a1", 2, "rejected"],
			[succeededRun.id, 1, "check@v1.a1", 2, "rejected"],
			[succeededRun.id, 1, "verify@v1.a1", 2, "rejected"],
		]);
	} finally {
		await app.stop();
	}
});
