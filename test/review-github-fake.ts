import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { repo } from "./review-support.ts";
import {
	emptyProjectFields,
	githubIssueNode,
	recordedDiscovery,
	repoReadIssues,
	repoReadResponse,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

type Recorded = {
	issues: Record<string, unknown>[];
	pulls: Record<string, unknown>[];
	checksBySha: Record<string, Record<string, unknown>[]>;
	commentsByPull: Record<number, Record<string, unknown>[]>;
	reviewsByPull: Record<number, Record<string, unknown>[]>;
	reactionsByPull: Record<number, Record<string, unknown>[]>;
	commentsByIssue?: Record<number, Record<string, unknown>[]>;
	commitsBySha?: Record<string, Record<string, unknown>>;
	mergedPulls?: Record<string, unknown>[];
	closedNext?: string | null;
};

export function page(items: unknown): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

export function connection<T>(nodes: T[]): {
	nodes: T[];
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
	return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

function repoReadFromRecorded(recorded: Recorded): unknown {
	const pullNode = (item: Record<string, unknown>, merged: boolean) => {
		const head = item.head as { ref?: string; sha?: string } | undefined;
		const number = Number(item.number);
		const sha = head?.sha ?? "";
		return {
			number,
			title: item.title,
			url: item.html_url,
			isDraft: item.draft === true,
			body: item.body ?? "",
			state: merged ? "MERGED" : "OPEN",
			mergedAt: merged ? (item.merged_at ?? "2026-08-01T00:00:00Z") : null,
			headRefName: head?.ref ?? "",
			headRefOid: sha,
			closingIssuesReferences: connection(
				String(item.body ?? "").match(/#(\d+)/) === null
					? []
					: [{ number: Number(String(item.body).match(/#(\d+)/)?.[1]) }],
			),
			reviews: connection(
				(recorded.reviewsByPull[number] ?? []).map((review) => ({
					author: review.user ?? null,
					commit: { oid: review.commit_id },
					state: review.state,
				})),
			),
			comments: connection(
				(recorded.commentsByPull[number] ?? []).map((comment) => ({
					author: comment.user ?? null,
					body: comment.body,
					createdAt: comment.created_at,
					reactions: { totalCount: 0 },
				})),
			),
			reactions: connection(
				(recorded.reactionsByPull[number] ?? []).map((reaction) => ({
					user: reaction.user ?? null,
					content: String(reaction.content ?? "").toUpperCase(),
					createdAt: reaction.created_at,
				})),
			),
			commits: connection([
				{
					commit: {
						committedDate:
							(
								recorded.commitsBySha?.[sha]?.commit as
									{ committer?: { date?: string } } | undefined
							)?.committer?.date ?? null,
					},
				},
			]),
			statusCheckRollup: {
				contexts: connection(
					(recorded.checksBySha[sha] ?? []).map((check) => ({
						name: check.name,
						status: String(check.status ?? "").toUpperCase(),
						conclusion:
							check.conclusion === null || check.conclusion === undefined
								? null
								: String(check.conclusion).toUpperCase(),
					})),
				),
			},
		};
	};
	const body = repoReadIssues(
		"acme",
		"widget",
		recorded.issues.map((item) => {
			const number = Number(item.number);
			const node = githubIssueNode(item);
			node.comments = connection(
				(recorded.commentsByIssue?.[number] ?? []).map((comment) => ({
					databaseId: comment.id,
					body: comment.body,
					createdAt: comment.created_at,
					updatedAt: comment.updated_at,
					author: comment.user ?? null,
					reactions: { totalCount: 0 },
				})),
			);
			return node;
		}),
		{ pulls: recorded.pulls.map((item) => pullNode(item, false)) },
	) as { data: { repository: { mergedPullRequests: { nodes: unknown[] } } } };
	body.data.repository.mergedPullRequests.nodes = (
		recorded.mergedPulls ?? []
	).map((item) => pullNode(item, true));
	return body;
}

export function githubFetch(recorded: Recorded): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return page({ login: "lev" });
		}
		if (
			url ===
			`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`
		) {
			return page(recorded.issues);
		}
		if (
			url ===
			`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
		) {
			return page(recorded.pulls);
		}
		if (
			url ===
			`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
		) {
			const headers = new Headers({ "content-type": "application/json" });
			if (recorded.closedNext !== undefined && recorded.closedNext !== null) {
				headers.set("link", `<${recorded.closedNext}>; rel="next"`);
			}
			return new Response(JSON.stringify(recorded.mergedPulls ?? []), {
				status: 200,
				headers,
			});
		}
		if (url.includes("/pulls?state=closed&per_page=10&page=2")) {
			return new Response("followed closed page", { status: 500 });
		}
		if (
			url ===
			`https://api.github.com/repos/${repo}/branches?per_page=100&page=1`
		) {
			return page([]);
		}
		const checkMatch = url.match(/\/commits\/([^/]+)\/check-runs/);
		if (checkMatch?.[1] !== undefined) {
			return page({ check_runs: recorded.checksBySha[checkMatch[1]] ?? [] });
		}
		const commitMatch = url.match(/\/commits\/([^/?]+)$/);
		if (commitMatch?.[1] !== undefined) {
			const commit = recorded.commitsBySha?.[commitMatch[1]];
			if (commit === undefined) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
			}
			return page(commit);
		}
		const thread = url.match(
			/\/(?:issues|pulls)\/(\d+)\/(comments|reviews|reactions)\?per_page=100&page=(\d+)/,
		);
		if (thread?.[1] !== undefined && thread[2] !== undefined) {
			const number = Number(thread[1]);
			const issueComments =
				url.includes("/issues/") && thread[2] === "comments"
					? recorded.commentsByIssue?.[number]
					: undefined;
			const rows =
				issueComments ??
				(thread[2] === "comments"
					? recorded.commentsByPull[number]
					: thread[2] === "reviews"
						? recorded.reviewsByPull[number]
						: recorded.reactionsByPull[number]) ??
				[];
			const pageNumber = Number(thread[3]);
			const start = (pageNumber - 1) * 100;
			const slice = rows.slice(start, start + 100);
			const headers = new Headers({ "content-type": "application/json" });
			if (rows.length > 100 && pageNumber === 1) {
				const next = new URL(url);
				next.searchParams.set("page", "2");
				headers.set("link", `<${next.href}>; rel="next"`);
			}
			return new Response(JSON.stringify(slice), { status: 200, headers });
		}
		if (url === "https://api.github.com/graphql") {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("query RepoRead")) {
				return page(repoReadFromRecorded(recorded));
			}
			const read = repoReadResponse(input, init);
			if (read !== null) {
				return read;
			}
			return page({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			});
		}
		if (url.includes("/labels?")) {
			return page([]);
		}
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
}

export async function overview(
	recorded: Pick<Recorded, "issues" | "pulls"> &
		Partial<Omit<Recorded, "issues" | "pulls">> & {
			config?: string;
			withNeedsYou?: boolean;
		},
): Promise<unknown> {
	const { path, cleanup } = await tempConfig(
		recorded.config ??
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<unknown>((resolve, reject) => {
		startChecks = (base: string) => {
			const listed = recorded.withNeedsYou === true;
			const responses = listed
				? Promise.all([
						fetch(new URL("/api/overview", base)),
						fetch(new URL("/api/needs-you", base)),
					])
				: fetch(new URL("/api/overview", base)).then((response) => [response]);
			responses
				.then(async (pages) => {
					const overviewPage = pages[0];
					if (overviewPage === undefined) {
						throw new Error("overview response was missing");
					}
					expect(overviewPage.status).toBe(200);
					const body: unknown = await overviewPage.json();
					if (!listed) {
						resolve(body);
						return;
					}
					const needsYouPage = pages[1];
					if (needsYouPage === undefined) {
						throw new Error("needs-you response was missing");
					}
					expect(needsYouPage.status).toBe(200);
					const needsYou: unknown = await needsYouPage.json();
					resolve({ body, needsYou });
				})
				.catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: githubFetch({
					issues: recorded.issues,
					pulls: recorded.pulls,
					checksBySha: recorded.checksBySha ?? {},
					commentsByPull: recorded.commentsByPull ?? {},
					reviewsByPull: recorded.reviewsByPull ?? {},
					reactionsByPull: recorded.reactionsByPull ?? {},
					...(recorded.commentsByIssue === undefined
						? {}
						: { commentsByIssue: recorded.commentsByIssue }),
					...(recorded.commitsBySha === undefined
						? {}
						: { commitsBySha: recorded.commitsBySha }),
					mergedPulls: recorded.mergedPulls ?? [],
					...(recorded.closedNext === undefined
						? {}
						: { closedNext: recorded.closedNext }),
				}),
				readGhToken: async () => null,
				databasePath,
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks.then(() => undefined),
			}),
		);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr);
		}
		expect(result.stderr).toBe("");
		return await checks;
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}
