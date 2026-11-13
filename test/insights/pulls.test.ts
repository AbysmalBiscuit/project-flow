import { expect, test } from "bun:test";

import hubRuns from "../fixtures/factory-hub-runs.json";
import {
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

/** The app with one hub whose succeeded run opened PR 77, and a GitHub that answers its size. */
async function serveWithPull() {
	const requests: FactoryRequest[] = [];
	const githubReads: string[] = [];
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch(
			{
				[hubUrl]: {
					...hub,
					[`/runs/${succeededRun.id}`]: {
						pr: { owner: "acme", repo: "widget", number: 77, url: pullUrl },
						outputs: { merge_sha: "4f1c2d" },
					},
					[`/runs/${failedRun.id}`]: { pr: null, outputs: null },
				},
			},
			requests,
			async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/repos/acme/widget/pulls/77") {
					githubReads.push(url);
					return json({
						number: 77,
						additions: 120,
						deletions: 30,
						changed_files: 6,
						created_at: "2026-10-25T13:30:00Z",
						merged_at: "2026-10-25T13:47:00Z",
					});
				}
				return recordedDiscovery(input, init) ?? unrecorded(input, init);
			},
		),
		{ env: { GITHUB_TOKEN: "recorded-token" } },
	);
	return { ...app, githubReads: () => githubReads };
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
