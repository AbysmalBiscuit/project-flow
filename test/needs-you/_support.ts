import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";

export const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

export const linearProject = {
	id: "project-flow",
	name: "Project Flow",
	slugId: "project-flow",
};

export function linearIssue(
	identifier: string,
	title: string,
	description: string,
	comments: { body: string; user?: { id: string; name: string } }[] = [],
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title,
		description,
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		labels: { nodes: [] },
		comments: { nodes: comments },
		assignee: null,
		...fields,
	};
}

/** An open GitHub issue as the issue list returns it. */
export function openIssue(number: number, title: string) {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		comments: 0,
		assignee: null,
		labels: [],
	};
}

/** An open PR of `repo` as the open PR list returns it. */
export function openPull(
	repo: string,
	number: number,
	title: string,
	body: string,
	{ ref = `pr-${number}`, draft = false } = {},
) {
	return {
		number,
		title,
		state: "open",
		draft,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref, sha: `sha-${number}` },
		body,
		merged_at: null,
	};
}

/** A comment as the issue comment list returns it. */
export type RecordedComment = {
	body: string;
	created_at: string;
	user: { login: string };
	reactions?: { total_count: number };
};

/**
 * Recorded GitHub answers for one repo: its open issues, its open PRs, the
 * comments of each PR, and the check runs of each head. Every other list is empty.
 */
export function githubRecorded(
	repo: string,
	{
		issues = [],
		pulls = [],
		comments = {},
		checkRuns = [],
	}: {
		issues?: ReturnType<typeof openIssue>[];
		pulls?: ReturnType<typeof openPull>[];
		comments?: Record<number, RecordedComment[]>;
		checkRuns?: { name: string; status: string; conclusion: string }[];
	},
): Fetch {
	const recorded: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes("query RepoRead")) {
				const read = await repoReadFromHandler(input, init, recorded);
				if (read !== null) {
					return read;
				}
			}
			return Response.json({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			});
		}
		if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
			return page(issues);
		}
		if (
			url ===
			`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
		) {
			return page(pulls);
		}
		for (const [number, list] of Object.entries(comments)) {
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`
			) {
				return page(list);
			}
		}
		if (url.includes("/check-runs")) {
			return Response.json({ check_runs: checkRuns });
		}
		if (url.includes("/commits/")) {
			return Response.json({
				commit: { committer: { date: "2026-10-01T00:00:00Z" } },
			});
		}
		if (
			url.includes("/pulls?state=closed") ||
			url.includes("/labels?") ||
			url.includes("/branches?") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions")
		) {
			return page([]);
		}
		return unrecorded(input);
	};
	return recorded;
}

/**
 * Start the app on `fetchImpl` with the configuration `config`, and read the
 * Needs you items and the needs-you count of the first project of the overview.
 */
export async function readNeedsYou(
	fetchImpl: Fetch,
	config: Record<string, unknown>,
	now?: Date,
): Promise<{ items: NeedsYouItem[]; needsYou: number }> {
	const { path, cleanup } = await tempConfig(JSON.stringify(config));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<{ items: NeedsYouItem[]; needsYou: number }>(
		(resolve, reject) => {
			startChecks = (base) => {
				Promise.all([
					fetch(new URL("/api/needs-you", base)),
					fetch(new URL("/api/overview", base)),
				])
					.then(async ([needs, overview]) => {
						expect(needs.status).toBe(200);
						expect(overview.status).toBe(200);
						const { projects } = (await overview.json()) as {
							projects: { needsYou: number }[];
						};
						resolve({
							items: (await needs.json()) as NeedsYouItem[],
							needsYou: projects[0]?.needsYou ?? 0,
						});
					})
					.catch(reject);
			};
		},
	);
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				...(now === undefined ? {} : { now: () => now }),
				stdout: (line) => startChecks(line),
				waitForStop: checks.then(() => undefined),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		return await checks;
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}
