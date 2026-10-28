import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	recordedDiscovery,
	repo as githubRepo,
	unrecorded,
} from "../support/github.ts";
import { repoReadFromLists } from "../support/repo-read.ts";
import { ask, inboxOf, notificationAfterRefresh, refresh } from "./_support.ts";

function githubPage(items: unknown): Response {
	return Response.json(items);
}

function githubIssue(
	number: number,
	comments: number,
): Record<string, unknown> {
	return {
		number,
		title: "Ship the signing key",
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		comments,
		assignee: null,
		labels: [],
	};
}

function githubPull(number: number, body: string): Record<string, unknown> {
	return {
		number,
		title: "Count PR asks",
		state: "open",
		draft: false,
		html_url: `https://github.com/${githubRepo}/pull/${number}`,
		head: { ref: `${number}-feat-pr-ask`, sha: `sha-${number}` },
		body,
		merged_at: null,
	};
}

function githubComment(
	body: string,
	createdAt: string,
	login = "agent",
): Record<string, unknown> {
	return {
		body,
		created_at: createdAt,
		user: { login },
	};
}

async function withGithubInbox(
	issueComments: Record<number, Record<string, unknown>[]>,
	pullComments: Record<number, Record<string, unknown>[]>,
	checks: (
		base: string,
		setComments: (next: {
			issues: Record<number, Record<string, unknown>[]>;
			pulls: Record<number, Record<string, unknown>[]>;
		}) => void,
	) => Promise<void>,
	issues: Record<string, unknown>[] = [githubIssue(8, 0)],
	pulls: Record<string, unknown>[] = [githubPull(49, "Closes #8")],
): Promise<void> {
	let currentIssues = issueComments;
	let currentPulls = pullComments;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return githubPage({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql") {
			const read = repoReadFromLists(
				input,
				init,
				{ [githubRepo]: issues },
				{
					[githubRepo]: pulls.map((pull) => ({
						...pull,
						commentRows: currentPulls[Number(pull.number)] ?? [],
					})),
				},
			);
			if (read !== null) {
				return read;
			}
			return githubPage({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			});
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return githubPage(issues);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=100&page=1`
		) {
			return githubPage(pulls);
		}
		const comments = url.match(
			/\/issues\/(\d+)\/comments\?per_page=100&page=1$/,
		);
		if (comments?.[1] !== undefined) {
			const number = Number(comments[1]);
			const onIssue = currentIssues[number];
			if (onIssue !== undefined) {
				return githubPage(onIssue);
			}
			const onPull = currentPulls[number];
			if (onPull !== undefined) {
				return githubPage(onPull);
			}
		}
		if (
			url.includes("/pulls?state=closed") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/comments?") ||
			url.includes("/reviews?") ||
			url.includes("/reactions?") ||
			url.includes("/check-runs") ||
			url.includes("/commits/")
		) {
			return url.includes("/check-runs")
				? Response.json({ check_runs: [] })
				: url.includes("/commits/")
					? Response.json({
							commit: { committer: { date: "2026-10-01T00:00:00Z" } },
						})
					: githubPage([]);
		}
		return unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			checks(base, (next) => {
				currentIssues = next.issues;
				currentPulls = next.pulls;
			}).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: done,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("inbox pull comments", () => {
	test("a new comment on a linked PR raises New comment for its ticket", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				const listed = await fetch(new URL("/api/needs-you", base));
				expect(listed.status).toBe(200);
				expect(await listed.json()).toEqual([
					expect.objectContaining({
						key: `${githubRepo}#8`,
						reason: "ask",
						headline,
					}),
				]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the linked PR.",
								"2026-10-01T02:00:00Z",
							),
						],
					},
				});
				const event = await notificationAfterRefresh(base);
				expect(event).toMatchObject({
					trigger: "comment",
					project: githubRepo,
					key: `${githubRepo}#8`,
					text: headline,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
		);
	});

	test("a new comment on a PR ask raises New comment", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				const listed = await fetch(new URL("/api/needs-you", base));
				expect(listed.status).toBe(200);
				expect(await listed.json()).toEqual([
					expect.objectContaining({
						key: `${githubRepo}#49`,
						reason: "ask",
						headline,
					}),
				]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the PR ask.",
								"2026-10-01T02:00:00Z",
							),
						],
					},
				});
				const event = await notificationAfterRefresh(base);
				expect(event).toMatchObject({
					trigger: "comment",
					project: githubRepo,
					key: `${githubRepo}#49`,
					text: headline,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
			[],
			[githubPull(49, "A fix with no ticket.")],
		);
	});

	test("a blank linked PR comment and the viewer's own PR comment add no inbox entry", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment("   ", "2026-10-01T01:00:00Z"),
							githubComment(
								"A note from the viewer.",
								"2026-10-01T02:00:00Z",
								"lev",
							),
						],
					},
				});
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the linked PR.",
								"2026-10-01T03:00:00Z",
							),
						],
					},
				});
				const event = await notificationAfterRefresh(base);
				expect(event).toMatchObject({
					trigger: "comment",
					key: `${githubRepo}#8`,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
		);
	});
});
