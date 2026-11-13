import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import hubRuns from "../fixtures/factory-hub-runs.json";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";
import { json, urlOf } from "../support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../support/github.ts";
import { answerWhere, insightTables } from "./_support.ts";

function runOf(ticket: string) {
	const found = hubRuns.runs.find((run) => run.ticket === ticket);
	if (found === undefined) {
		throw new Error(`the hub runs fixture lost the run of ticket ${ticket}`);
	}
	return found;
}

const failedRun = runOf("39");
const succeededRun = runOf("40");
const pullUrl = "https://github.com/acme/widget/pull/77";

const pullSize = () =>
	json({
		number: 77,
		additions: 120,
		deletions: 30,
		changed_files: 6,
		created_at: "2026-10-25T13:30:00Z",
		merged_at: "2026-10-25T13:47:00Z",
	});

/**
 * The app with one hub whose succeeded run opened PR 77, and a GitHub that answers its size.
 * `pullRead: false` leaves out the PR route of the succeeded run, and `machine` moves that run to another box.
 */
async function serveWithPull(
	options: {
		databasePath?: string;
		now?: () => Date;
		github?: () => Response;
		pullRead?: boolean;
		machine?: string;
		stderr?: (line: string) => void;
	} = {},
) {
	const requests: FactoryRequest[] = [];
	const githubReads: string[] = [];
	const answers: Answers = {
		...hub,
		"/runs": {
			runs: hubRuns.runs.map((run) =>
				run.id === succeededRun.id && options.machine !== undefined
					? { ...run, machine: options.machine }
					: run,
			),
		},
		[`/runs/${failedRun.id}`]: { pr: null, outputs: null },
		...(options.pullRead === false
			? {}
			: {
					[`/runs/${succeededRun.id}`]: {
						pr: { owner: "acme", repo: "widget", number: 77, url: pullUrl },
						outputs: { merge_sha: "4f1c2d" },
					},
				}),
	};
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests, async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/repos/acme/widget/pulls/77") {
				githubReads.push(url);
				return (options.github ?? pullSize)();
			}
			return recordedDiscovery(input, init) ?? unrecorded(input, init);
		}),
		{
			env: { GITHUB_TOKEN: "recorded-token" },
			...(options.databasePath === undefined
				? {}
				: { databasePath: options.databasePath }),
			...(options.now === undefined ? {} : { now: options.now }),
			...(options.stderr === undefined ? {} : { stderr: options.stderr }),
		},
	);
	return {
		...app,
		githubReads: () => githubReads,
		paths: () => requests.map((request) => new URL(request.url).pathname),
	};
}

test("the pulls view keeps the size of the PR of each ended run, read once from the forge", async () => {
	const app = await serveWithPull();
	try {
		const answer = await answerWhere(
			app.base,
			"select run_id, url, repo, number, additions, deletions, changed_files, opened_at, merged_at from pulls",
			(count) => count > 0,
		);
		expect(answer.rows).toEqual([
			[
				succeededRun.id,
				pullUrl,
				"acme/widget",
				77,
				120,
				30,
				6,
				"2026-10-25T13:30:00Z",
				"2026-10-25T13:47:00Z",
			],
		]);
		expect(app.githubReads()).toHaveLength(1);
	} finally {
		await app.stop();
	}
});

test("Insights lists the pulls table with its columns", async () => {
	const app = await serveWithPull();
	try {
		const { tables } = await insightTables(app.base);
		expect(tables.find((table) => table.name === "pulls")).toEqual({
			name: "pulls",
			columns: [
				"run_id",
				"url",
				"repo",
				"number",
				"additions",
				"deletions",
				"changed_files",
				"opened_at",
				"merged_at",
			],
		});
	} finally {
		await app.stop();
	}
});

test("a restart keeps a merged run merged, and does not read its PR again", async () => {
	const root = await mkdtemp(join(tmpdir(), "project-flow-pulls-"));
	const databasePath = join(root, "store.sqlite");
	try {
		const first = await serveWithPull({ databasePath });
		try {
			await answerWhere(
				first.base,
				"select run_id from pulls",
				(count) => count === 1,
			);
			await answerWhere(
				first.base,
				`select id from runs where id = '${succeededRun.id}' and result = 'merged'`,
				(count) => count === 1,
			);
		} finally {
			await first.stop();
		}
		const second = await serveWithPull({
			databasePath,
			pullRead: false,
			machine: "box-c",
		});
		try {
			const answer = await answerWhere(
				second.base,
				`select result from runs where id = '${succeededRun.id}' and box = 'box-c'`,
				(count) => count === 1,
			);
			expect(answer.rows).toEqual([["merged"]]);
			expect(second.paths()).not.toContain(`/runs/${succeededRun.id}`);
		} finally {
			await second.stop();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a rate-limited PR size read waits for the reset, logs it once, then fills the row", async () => {
	let now = Date.parse("2026-10-25T15:00:00Z");
	const reset = now + 60_000;
	let calls = 0;
	const lines: string[] = [];
	const app = await serveWithPull({
		now: () => new Date(now),
		github: () => {
			calls += 1;
			return calls === 1
				? new Response("rate limited", {
						status: 403,
						headers: {
							"x-ratelimit-remaining": "0",
							"x-ratelimit-reset": String(reset / 1_000),
						},
					})
				: pullSize();
		},
		stderr: (line) => lines.push(line),
	});
	try {
		while (app.githubReads().length < 1) {
			await Bun.sleep(10);
		}
		for (let step = 0; step < 5; step += 1) {
			now += 10_000;
			await Bun.sleep(100);
		}
		expect(app.githubReads()).toHaveLength(1);
		now = reset + 10_000;
		const answer = await answerWhere(
			app.base,
			"select additions from pulls where additions is not null",
			(count) => count === 1,
		);
		expect(answer.rows).toEqual([[120]]);
		expect(app.githubReads()).toHaveLength(2);
		expect(lines.filter((line) => line.includes("rate limit"))).toHaveLength(1);
	} finally {
		await app.stop();
	}
});
