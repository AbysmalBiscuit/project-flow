import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeedsYouItem } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import issue51Comments from "./fixtures/issue-51-comments.json";
import {
	emptyProjectFields,
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";
const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const codex = "chatgpt-codex-connector[bot]";
const grok = "grok-code-review[bot]";
const greptile = "greptile-apps[bot]";

function card(
	state: "backlog" | "inProgress" | "inReview" | "awaitingMerge",
	counts: {
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
	},
	tags: string[] = [],
	needsYou = counts.awaitingMerge,
	key = `${repo}#8`,
	title = "Ticket 8",
): {
	projects: {
		name: string;
		tracker: "github";
		ref: { tracker: "github"; repo: string };
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
		needsYou: number;
		progress: number;
		fetchedAt: string;
		error: null;
		tags: string[];
		unlinkedPrs: [];
		tickets: {
			key: string;
			title: string;
			state: string;
			blockers: [];
			lane: string;
			statusType: string;
			enteredStateAt: string;
			updatedAt: string;
		}[];
		crossProjectBlockers: [];
		statusTypes: Record<string, number>;
	}[];
	fetchedAt: string;
	error: null;
} {
	return {
		projects: [
			{
				name: repo,
				tracker: "github",
				ref: { tracker: "github", repo },
				done: 0,
				dropped: 0,
				blocked: 0,
				...counts,
				needsYou,
				progress: 0,
				fetchedAt: "2026-10-18T12:00:00.000Z",
				error: null,
				tags,
				unlinkedPrs: [],
				tickets: [
					{
						key,
						title,
						state,
						blockers: [],
						lane: laneName(state),
						statusType: state,
						enteredStateAt: "2026-10-01T00:00:00Z",
						updatedAt: "2026-10-01T00:00:00Z",
					},
				],
				crossProjectBlockers: [],
				statusTypes: {
					backlog: state === "backlog" ? 1 : 0,
					inProgress: state === "inProgress" ? 1 : 0,
					inReview: state === "inReview" ? 1 : 0,
					awaitingMerge: state === "awaitingMerge" ? 1 : 0,
					done: 0,
					dropped: 0,
				},
			},
		],
		fetchedAt: "2026-10-18T12:00:00.000Z",
		error: null,
	};
}

function laneName(state: string): string {
	if (state === "inProgress") {
		return "In progress";
	}
	if (state === "inReview") {
		return "In review";
	}
	if (state === "awaitingMerge") {
		return "Awaiting merge";
	}
	return "Backlog";
}

function issue(number: number): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-10-01T00:00:00Z",
	};
}

function progress(lines: string): string {
	return `**Workcell progress**\n\n${lines}`;
}

function pull(
	number: number,
	ticket = 8,
	sha = head,
	draft = false,
): Record<string, unknown> {
	return {
		number,
		title: `PR ${number}`,
		state: "open",
		draft,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `${number}-feat-review`, sha },
		body: `Closes #${ticket}`,
		merged_at: null,
	};
}

function mergedPull(): Record<string, unknown> {
	return {
		number: 1,
		title: "merged",
		state: "closed",
		draft: false,
		html_url: `https://github.com/${repo}/pull/1`,
		head: { ref: "1-merged", sha: older },
		body: "",
		merged_at: "2026-10-01T00:00:00Z",
	};
}

function projectBoard(
	pulls: { number: number; repo?: string }[] = [{ number: 83 }],
	closingPages?: {
		nodes: { number: number; repository?: { nameWithOwner: string } }[];
		endCursor: string | null;
	}[],
	restComments?: { body: string; user?: { login: string } | null }[],
	extraIssues: {
		id: string;
		number: number;
		title: string;
		pulls: { number: number; repo?: string }[];
		comments: { body: string; user?: { login: string } | null }[];
	}[] = [],
): Fetch {
	const projectId = "PVT_widget";
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const sent = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return page({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql" && sent.includes("$owner")) {
			return page({
				data: {
					repositoryOwner: {
						projectV2: {
							id: projectId,
							number: 7,
							title: "Widget board",
							closed: false,
							updatedAt: "2026-10-01T00:00:00Z",
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("closedByPullRequestsReferences") &&
			!sent.includes("ProjectV2")
		) {
			const variables = JSON.parse(sent) as {
				variables?: { after?: string | null };
			};
			const after = variables.variables?.after ?? null;
			const index =
				closingPages === undefined
					? -1
					: closingPages.findIndex(
							(_item, itemIndex) =>
								closingPages[itemIndex - 1]?.endCursor === after,
						);
			const listed = closingPages?.[index];
			if (listed === undefined) {
				return new Response("closing page not recorded", { status: 404 });
			}
			return page({
				data: {
					node: {
						closedByPullRequestsReferences: {
							nodes: listed.nodes,
							pageInfo: {
								hasNextPage: listed.endCursor !== null,
								endCursor: listed.endCursor,
							},
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("ProjectFields")
		) {
			return emptyProjectFields(input, init) ?? unrecorded(input);
		}
		if (url === "https://api.github.com/graphql" && sent.includes("node(id:")) {
			const variables = JSON.parse(sent) as {
				variables?: { after?: string | null };
			};
			const after = variables.variables?.after ?? null;
			const closing =
				closingPages === undefined
					? {
							nodes: pulls.map((item) => ({ number: item.number })),
							hasNextPage: false,
							endCursor: null,
						}
					: (() => {
							const index =
								after === null
									? 0
									: closingPages.findIndex(
											(_item, itemIndex) =>
												closingPages[itemIndex - 1]?.endCursor === after,
										);
							const listed = closingPages[index];
							if (listed === undefined) {
								return null;
							}
							return {
								nodes: listed.nodes,
								hasNextPage: listed.endCursor !== null,
								endCursor: listed.endCursor,
							};
						})();
			if (closing === null) {
				return new Response("closing page not recorded", { status: 404 });
			}
			const issueNodes = [
				{
					content: {
						__typename: "Issue",
						id: "I_widget_8",
						number: 8,
						title: "Ticket 8",
						state: "OPEN",
						stateReason: null,
						updatedAt: "2026-10-01T00:00:00Z",
						repository: { nameWithOwner: repo },
						comments: {
							totalCount: (restComments ?? []).length,
						},
						closedByPullRequestsReferences: {
							nodes: closing.nodes.map((node) => ({
								number: node.number,
								...("repository" in node && node.repository !== undefined
									? { repository: node.repository }
									: {}),
							})),
							pageInfo: {
								hasNextPage: closing.hasNextPage,
								endCursor: closing.endCursor,
							},
						},
					},
				},
				...extraIssues.map((issue) => ({
					content: {
						__typename: "Issue",
						id: issue.id,
						number: issue.number,
						title: issue.title,
						state: "OPEN",
						stateReason: null,
						updatedAt: "2026-10-01T00:00:00Z",
						repository: { nameWithOwner: repo },
						comments: { totalCount: issue.comments.length },
						closedByPullRequestsReferences: {
							nodes: issue.pulls.map((node) => ({
								number: node.number,
								repository: { nameWithOwner: node.repo ?? repo },
							})),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				})),
			];
			return page({
				data: {
					node: {
						items: {
							nodes: issueNodes,
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		const pullMatch = url.match(/\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/);
		if (pullMatch?.[1] !== undefined && pullMatch[2] !== undefined) {
			const number = Number(pullMatch[2]);
			const recorded = pull(number);
			if (pullMatch[1] !== repo) {
				recorded.html_url = `https://github.com/${pullMatch[1]}/pull/${number}`;
			}
			return page(recorded);
		}
		if (url.includes("/commits/") && url.includes("/check-runs")) {
			return page({ check_runs: [] });
		}
		if (url.includes("/commits/")) {
			return page({
				commit: { committer: { date: "2026-10-01T00:00:00Z" } },
			});
		}
		if (url.includes("/pulls?state=closed")) {
			return page([]);
		}
		const issueComments = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${repo}/issues/(\\d+)/comments\\?per_page=100&page=1$`,
			),
		);
		if (issueComments?.[1] === "8") {
			return page(restComments ?? []);
		}
		const extra = extraIssues.find(
			(issue) => String(issue.number) === issueComments?.[1],
		);
		if (extra !== undefined) {
			return page(extra.comments);
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			url.includes("/branches") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
}

function page(items: unknown): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function githubFetch(recorded: {
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
}): Fetch {
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

async function overview(recorded: {
	issues: Record<string, unknown>[];
	pulls: Record<string, unknown>[];
	checksBySha?: Record<string, Record<string, unknown>[]>;
	commentsByPull?: Record<number, Record<string, unknown>[]>;
	reviewsByPull?: Record<number, Record<string, unknown>[]>;
	reactionsByPull?: Record<number, Record<string, unknown>[]>;
	commentsByIssue?: Record<number, Record<string, unknown>[]>;
	commitsBySha?: Record<string, Record<string, unknown>>;
	mergedPulls?: Record<string, unknown>[];
	closedNext?: string | null;
	config?: string;
	withNeedsYou?: boolean;
}): Promise<unknown> {
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

describe("review cycle", () => {
	test("an open PR with a changes-requested review is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(83)],
			reviewsByPull: {
				83: [
					{
						user: { login: codex },
						commit_id: older,
						state: "CHANGES_REQUESTED",
					},
				],
			},
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				83: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a running Grok check on the head commit stays in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(84)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a Grok review on the head past the first page is awaiting merge", async () => {
		const filler = Array.from({ length: 100 }, () => ({
			user: { login: "someone" },
			commit_id: older,
			state: "COMMENTED",
		}));
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(97)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				97: [
					...filler,
					{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a finished Grok review on the head commit is awaiting merge", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(85)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				85: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { body: unknown; needsYou: NeedsYouItem[] };
		expect(listed.body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			review: "completed",
		});
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull?.review,
		).not.toBe("approved");
	});

	test("a later approval from the same reviewer supersedes changes requested", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(92)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "ci",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				92: [
					{
						user: { login: "ada" },
						commit_id: head,
						state: "CHANGES_REQUESTED",
					},
					{
						user: { login: "ada" },
						commit_id: head,
						state: "APPROVED",
					},
				],
			},
		})) as { needsYou: NeedsYouItem[] };
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			review: "approved",
		});
	});

	test("a Grok usage-limit comment counts only when it is newer than the head commit", async () => {
		const olderLimit = await overview({
			issues: [issue(8)],
			pulls: [pull(90)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			commentsByPull: {
				90: [
					{
						user: { login: grok },
						body: "You have reached your Grok usage limit for code reviews.",
						created_at: "2026-10-17T12:00:00Z",
					},
				],
			},
			commitsBySha: {
				[head]: {
					sha: head,
					commit: { committer: { date: "2026-10-18T11:00:00Z" } },
				},
			},
			mergedPulls: [mergedPull()],
		});
		expect(olderLimit).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
		const newerLimit = await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			commentsByPull: {
				91: [
					{
						user: { login: grok },
						body: "You have reached your Grok usage limit for code reviews.",
						created_at: "2026-10-18T11:30:00Z",
					},
				],
			},
			commitsBySha: {
				[head]: {
					sha: head,
					commit: { committer: { date: "2026-10-18T11:00:00Z" } },
				},
			},
			mergedPulls: [mergedPull()],
		});
		expect(newerLimit).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok usage limit"],
			),
		);
	});

	test("a Grok review on an older commit stays in review after a new push", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(86)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				86: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a Greptile summary with no running check is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(87)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
				87: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->\nConfidence Score: 5/5",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a running Greptile check keeps the PR in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(88)],
			checksBySha: {
				[head]: [
					{
						name: "Greptile review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "greptile" },
					},
				],
			},
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
				88: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a skipped Grok check counts as passing CI and keeps its warning", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "ci",
						status: "completed",
						conclusion: "success",
					},
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "skipped",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				91: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { body: unknown; needsYou: NeedsYouItem[] };
		expect(listed.body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok skipped"],
			),
		);
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			ci: "passing",
		});
		expect(JSON.stringify(listed.body)).toContain("grok skipped");
	});

	test("a skipped Greptile check is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(89)],
			checksBySha: {
				[head]: [
					{
						name: "Greptile review",
						status: "completed",
						conclusion: "skipped",
						app: { slug: "greptile" },
					},
				],
			},
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["greptile skipped"],
			),
		);
	});

	test("a cancelled Grok check on the head commit is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(80)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "cancelled",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok cancelled"],
			),
		);
	});

	test("a Codex review that left only a reaction is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(82)],
			reactionsByPull: {
				1: [{ user: { login: codex }, content: "+1" }],
				82: [{ user: { login: codex }, content: "+1" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a Codex summary with one finished review is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(99)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				99: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |\n| 📝 **Follow-up** | ⏳ **In progress** | `bbbbbbb` | later |",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a Codex in-progress reaction keeps the PR in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(90)],
			reactionsByPull: { 90: [{ user: { login: codex }, content: "eyes" }] },
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				90: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a failed review read does not show the PR as awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					databasePath,
					listCheckouts: async () => [],
					fetch: async (input, init) => {
						const url = urlOf(input);
						if (url.includes("/reviews?")) {
							return new Response("unavailable", { status: 500 });
						}
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(98)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
							mergedPulls: [],
						})(input, init);
					},
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("expected bots come from recorded merged PRs", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank expected-bot override is rejected and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [" "] },
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch({
						issues: [],
						pulls: [],
						checksBySha: {},
						commentsByPull: {},
						reviewsByPull: {},
						reactionsByPull: {},
					}),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("expectedBots");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a ready PR with no expected bots is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(93)],
			mergedPulls: [],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a draft PR skips review reads", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: async (input, init) => {
						requests.push(urlOf(input));
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(98, 8, head, true)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
						})(input, init);
					},
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
			expect(
				requests.some((url) =>
					/\/(?:issues|pulls)\/98\/|\/commits\/[^/]+\/check-runs/.test(url),
				),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear draft PR skips review reads", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFake({
						project: {
							id: "project-1",
							name: "Widget launch",
							slugId: linearProject,
						},
						issues: [
							{
								identifier: "WID-8",
								title: "Linear ticket 8",
								updatedAt: "2026-10-01T00:00:00.000Z",
								state: { type: "unstarted" },
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/99",
											title: "draft",
											sourceType: "github",
										},
									],
								},
							},
						],
						github: async (input, init) => {
							const url = urlOf(input);
							requests.push(url);
							const discovered = recordedDiscovery(input, init);
							if (discovered !== null) {
								return discovered;
							}
							if (url === "https://api.github.com/user") {
								return page({ login: "lev" });
							}
							if (url === "https://api.github.com/repos/acme/widget/pulls/99") {
								return page(pull(99, 8, head, true));
							}
							if (
								url.includes("/pulls?state=closed") ||
								url.includes("/labels?")
							) {
								return page([]);
							}
							return emptyProjectFields(input, init) ?? unrecorded(input);
						},
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
			expect(
				requests.some((url) =>
					/\/(?:issues|pulls)\/99\/|\/commits\/[^/]+\/check-runs/.test(url),
				),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a warning tag is in the overview", async () => {
		const body = (await overview({
			issues: [issue(8)],
			pulls: [pull(94)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "failure",
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { projects: { tags: string[] }[] };
		expect(body.projects[0]?.tags).toContain("grok failure");
	});

	test("a failed Grok check is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(94)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "failure",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok failure"],
			),
		);
	});

	test("a configuration override wins over detected expected bots", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(92)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
			config: JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [] },
			}),
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a merged history page skips the closing-refs query", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: async (input, init) => {
						const url = urlOf(input);
						const body = typeof init?.body === "string" ? init.body : "";
						requests.push(
							url === "https://api.github.com/graphql" ? body : url,
						);
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(95)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
							mergedPulls: [mergedPull()],
						})(input, init);
					},
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
			await checks;
			const graphql = requests.filter((item) =>
				item.includes("LinkedDevelopment"),
			);
			expect(graphql).toHaveLength(1);
			expect(graphql[0]).toContain('"number":95');
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a merged PR that closes an open ticket moves it to Done", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [
				{
					...mergedPull(),
					body: "Closes #8",
				},
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					ref: { tracker: "github", repo },
					done: 1,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					needsYou: 0,
					progress: 100,
					fetchedAt: "2026-10-18T12:00:00.000Z",
					error: null,
					tags: [],
					unlinkedPrs: [],
					tickets: [
						{
							key: `${repo}#8`,
							title: "Ticket 8",
							state: "done",
							blockers: [],
							lane: "Done",
							statusType: "done",
							enteredStateAt: "2026-10-01T00:00:00Z",
							updatedAt: "2026-10-01T00:00:00Z",
						},
					],
					crossProjectBlockers: [],
					statusTypes: {
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						done: 1,
						dropped: 0,
					},
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("a closed PR list with a next link fetches only page 1", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(95)],
			closedNext: `https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=2`,
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a Linear project does not wait on another repo's bot", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const other = "acme/other";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		const fetchImpl: Fetch = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/96",
								title: "ready",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/96") {
					return page({
						...pull(96, 8),
						html_url: "https://github.com/acme/widget/pull/96",
					});
				}
				if (
					url ===
					`https://api.github.com/repos/${other}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([
						{
							number: 2,
							title: "merged elsewhere",
							state: "closed",
							draft: false,
							html_url: `https://github.com/${other}/pull/2`,
							head: { ref: "2-merged", sha: older },
							body: "",
							merged_at: "2026-10-01T00:00:00Z",
						},
					]);
				}
				if (
					url ===
					`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([]);
				}
				if (url.includes(`/repos/${other}/`) && url.includes("/comments?")) {
					return page([
						{ user: { login: greptile }, body: "<!-- greptile_summary -->" },
					]);
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (
					url.includes("/comments?") ||
					url.includes("/reviews?") ||
					url.includes("/reactions?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			const body = (await checks) as {
				projects: { tickets: { state: string }[] }[];
			};
			expect(body.projects[0]?.tickets[0]?.state).toBe("awaitingMerge");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear expected-bot override wins", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		const fetchImpl: Fetch = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/96",
								title: "ready",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
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
					`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([mergedPull()]);
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/96") {
					return page({
						...pull(96, 8),
						html_url: "https://github.com/acme/widget/pull/96",
					});
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/issues/1/comments?")) {
					return page([
						{ user: { login: greptile }, body: "<!-- greptile_summary -->" },
					]);
				}
				if (
					url.includes("/comments?") ||
					url.includes("/reviews?") ||
					url.includes("/reactions?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			expect(await checks).toEqual({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						ref: { tracker: "linear", project: linearProject },
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 1,
						needsYou: 1,
						progress: 0,
						fetchedAt: "2026-10-18T12:00:00.000Z",
						error: null,
						statusTypes: {
							backlog: 0,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 1,
							done: 0,
							dropped: 0,
						},
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-8",
								title: "Linear ticket 8",
								state: "awaitingMerge",
								blockers: [],
								lane: "Awaiting merge",
								statusType: "awaitingMerge",
								enteredStateAt: "2026-10-01T00:00:00.000Z",
								updatedAt: "2026-10-01T00:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
					},
				],
				fetchedAt: "2026-10-18T12:00:00.000Z",
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Codex usage-limit comment is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(81)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				81: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["codex usage limit"],
			),
		);
	});

	test("a Codex usage-limit comment newer than the eyes reaction marks Codex done with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(98)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				98: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
						created_at: "2026-10-18T11:30:00Z",
					},
				],
			},
			reactionsByPull: {
				98: [
					{
						user: { login: codex },
						content: "eyes",
						created_at: "2026-10-18T11:00:00Z",
					},
				],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["codex usage limit"],
			),
		);
	});

	test("a Codex eyes reaction stays in review despite a usage-limit comment", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(97)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				97: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
					},
				],
			},
			reactionsByPull: {
				97: [{ user: { login: codex }, content: "eyes" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a second poll sends no review reads for a merged PR already seen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const reviewReads: string[] = [];
		const closedReads: string[] = [];
		const recorded = githubFetch({
			issues: [issue(8)],
			pulls: [pull(81)],
			checksBySha: {},
			commentsByPull: {
				1: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				],
			},
			reviewsByPull: {},
			reactionsByPull: {},
			mergedPulls: [mergedPull()],
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([issue(8)]);
			}
			if (url.includes("/pulls?state=closed")) {
				closedReads.push(url);
			}
			if (/\/(?:issues|pulls)\/1\/|\/commits\/[^/]+\/check-runs/.test(url)) {
				reviewReads.push(url);
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			const mergedReads = reviewReads.filter((url) =>
				/\/(?:issues|pulls)\/1\/|\/commits\/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\/check-runs/.test(
					url,
				),
			);
			expect(mergedReads).toHaveLength(4);
			expect(closedReads).toHaveLength(2);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a workcell run at stage 5 or earlier stays in review", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 1: implementing issue 8\n- stage 5: round 1 of 3",
						),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("an open merge ask on a workcell run is awaiting merge", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a workcell run that ended at its final report with the PR open is awaiting merge", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3\n- final report sent https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a progress entry after the final report puts the PR back in review", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (progressComment === undefined || report === undefined) {
			throw new Error("issue 51 comments were not recorded");
		}
		const body = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: issue51Comments },
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("an answered final-report ask puts the PR back in review and an open one keeps it awaiting merge", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (
			progressComment === undefined ||
			report === undefined ||
			typeof progressComment.body !== "string"
		) {
			throw new Error("issue 51 comments were not recorded");
		}
		const lines = progressComment.body.split("\n");
		const ask = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1:"),
		);
		const answeredAt = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1 answered:"),
		);
		if (ask < 0 || answeredAt < 0) {
			throw new Error("issue 51 progress has no ask-1 entry");
		}
		const openProgress = {
			...progressComment,
			body: lines.slice(0, ask + 1).join("\n"),
		};
		const answeredProgress = {
			...progressComment,
			body: lines.slice(0, answeredAt + 1).join("\n"),
		};
		const open = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(open).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
		);
		const answered = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [answeredProgress, report] },
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(answered).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("a second final report with an open ask keeps the PR awaiting merge", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (
			progressComment === undefined ||
			report === undefined ||
			typeof progressComment.body !== "string" ||
			typeof report.body !== "string"
		) {
			throw new Error("issue 51 comments were not recorded");
		}
		const lines = progressComment.body.split("\n");
		const askLine = lines.find((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1:"),
		);
		const answeredAt = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1 answered:"),
		);
		if (askLine === undefined || answeredAt < 0) {
			throw new Error("issue 51 progress has no ask-1 entry");
		}
		const resumed = {
			...progressComment,
			body: [
				...lines.slice(0, answeredAt + 1),
				"- stage 1: implementing the second report",
				"- stage 5: round 2 of 2",
				askLine.replace("ask-1:", "ask-2:"),
			].join("\n"),
		};
		const second = report.body.replaceAll("51-1", "51-2");
		const body = await overview({
			issues: [{ ...issue(51), comments: 3 }],
			pulls: [pull(52, 51)],
			commentsByIssue: {
				51: [resumed, report, { ...report, id: 6260874284, body: second }],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("a later stage line puts the PR back in review while the final-report ask stays open", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (
			progressComment === undefined ||
			report === undefined ||
			typeof progressComment.body !== "string"
		) {
			throw new Error("issue 51 comments were not recorded");
		}
		const openProgress = {
			...progressComment,
			body: progressComment.body
				.split("\n")
				.filter((line) => !line.includes("ask-1 answered:"))
				.join("\n"),
		};
		const resumed = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(resumed).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
		const noPmBot = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
			withNeedsYou: true,
			config: JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pmBot: { [repo]: false },
			}),
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(noPmBot).toEqual({
			body: card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
			needsYou: [
				expect.objectContaining({
					project: repo,
					tracker: "github",
					key: `${repo}#51`,
					headline: expect.any(String),
					reason: "ask",
					tags: [],
					answered: false,
					acknowledged: false,
				}),
			],
		});
	});

	test("a stage line after the final report puts the run back in review", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83\n- final report sent https://github.com/acme/widget/pull/83\n- stage 1: implementing issue 8 again https://github.com/acme/widget/pull/83",
						),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("an answered merge ask leaves the run at its stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 3 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
					},
					{ body: "answer: not yet" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank final-report ask leaves the run at its stage", async () => {
		const blank = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{ body: "   \n\n<!-- workcell:ask 8-1 -->" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(blank).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank progress line and repeated spaces still read the stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: `**Workcell progress**\n\n- \n-   stage   5: round 1 of 3`,
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a stage past 5 with no merge ask and no final report uses the expected bots", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [{ body: progress("- stage 6: merging") }],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a final report on one open PR leaves the other open PR in review", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/84\n- final report sent https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a stage line that names a PR as PR https://github.com/owner/repo/pull/N decides that PR only", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.\n- stage 6: merging. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
						),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank report marker and repeated spaces still follow the final-report ask", async () => {
		const blank = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{ body: "   \n\n<!-- workcell:report -->" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(blank).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		const spaced = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage   5: round 1 of 3\n- ask-1:   final   report for https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(spaced).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a marked report follows its ask and a marked report with no ask stays awaiting merge", async () => {
		const marked = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(marked).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		const answered = await overview({
			issues: [{ ...issue(8), comments: 3 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
					{ body: "answer: ship it" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(answered).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
		const open = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(open).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report that is also the ask is awaiting merge while the PR is open", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n**PR:** https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report that names no PR is awaiting merge for every open PR", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.\n- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.",
						),
					},
					{
						body: "Final report for   \n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report for one PR leaves the other open PR in review", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.\n- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a final report posted before the progress comment leaves the run at its stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
						),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a stage line that names no PR decides every open PR", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress("- stage 5: round 1 of 2. Session 01a150fd."),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("an open merge ask on one PR leaves the other open PR at its own stage", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/84",
						),
					},
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a failed comment read does not invent a workcell run", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = githubFetch({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			commentsByPull: {},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			reactionsByPull: {},
			mergedPulls: [mergedPull()],
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			requests.push(url);
			if (url.includes("/issues/8/comments")) {
				return new Response("recorded failure", { status: 500 });
			}
			return recorded(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(requests.some((url) => url.includes("/issues/8/comments"))).toBe(
				true,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a workcell progress comment on a Linear ticket keeps its PR in review", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const recorded = linearFake({
			requests,
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				requests.push(sent);
				return page({
					data: {
						issue: {
							comments: {
								nodes: [
									{
										body: progress(
											"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
										),
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: "WID-8", state: "inReview" }],
					},
				],
			});
			expect(requests.some((body) => body.includes("IssueComments"))).toBe(
				true,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report after a Linear progress comment sets its PR to awaiting merge", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentCursors: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				const after =
					(JSON.parse(sent) as { variables?: { after?: string | null } })
						.variables?.after ?? null;
				commentCursors.push(`comments:${after ?? "start"}`);
				const nodes =
					after === "page-2"
						? [
								{
									body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
								},
							]
						: [{ body: "noted" }];
				return page({
					data: {
						issue: {
							comments: {
								nodes,
								pageInfo: {
									hasNextPage: after !== "page-2",
									endCursor: after === "page-2" ? null : "page-2",
								},
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			const body = await checks;
			expect(commentCursors).toEqual(["comments:page-2"]);
			expect(body).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
			expect(body).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a later Linear comment page with a time stays after the progress comment", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
								createdAt: "2026-10-02T00:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentQueries: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				commentQueries.push(sent);
				const after =
					(JSON.parse(sent) as { variables?: { after?: string | null } })
						.variables?.after ?? null;
				const nodes =
					after === "page-2"
						? [
								{
									body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
									createdAt: "2026-10-03T00:00:00.000Z",
								},
							]
						: [
								{
									body: "noted",
									createdAt: "2026-10-01T00:00:00.000Z",
								},
							];
				return page({
					data: {
						issue: {
							comments: {
								nodes,
								pageInfo: {
									hasNextPage: after !== "page-2",
									endCursor: after === "page-2" ? null : "page-2",
								},
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			expect(commentQueries.some((body) => body.includes("createdAt"))).toBe(
				true,
			);
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a workcell progress comment on a GitHub project ticket keeps its PR in review", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank Linear comment does not invent a workcell run", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [{ body: "   " }, { body: null }],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: recorded,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed Linear comment page does not invent a workcell run", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [{ body: "noted" }],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				return new Response("recorded failure", { status: 500 });
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("Linear list comments failed");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report on a GitHub project ticket sets its PR to awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
			{
				body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
				user: null,
			},
		]);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report listed after the progress comment sets awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const progressBody = progress(
			"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
		);
		const reportBody =
			"Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->";
		const board = projectBoard([{ number: 83 }], undefined, [
			{ body: progressBody, user: null },
			{ body: reportBody, user: null },
		]);
		const commentReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/8/comments?per_page=100&page=1`
			) {
				commentReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
					},
				],
			});
			expect(commentReads.length).toBeGreaterThan(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed closing PR read does not drop the workcell review state", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		const fetchImpl: Fetch = async (input, init) => {
			if (
				urlOf(input) === "https://api.github.com/repos/acme/widget/pulls/83"
			) {
				return new Response("recorded failure", { status: 500 });
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("GitHub list pulls failed");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closing PR past the first page takes the workcell review state", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const earlier = Array.from({ length: 20 }, (_item, index) => ({
			number: index + 1,
			repository: { nameWithOwner: repo },
		}));
		const board = projectBoard(
			[],
			[
				{ nodes: earlier, endCursor: "closing-2" },
				{
					nodes: [{ number: 83, repository: { nameWithOwner: repo } }],
					endCursor: null,
				},
			],
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
					),
					user: null,
				},
			],
		);
		const pullReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const pullMatch = url.match(/\/pulls\/(\d+)$/);
			if (pullMatch?.[1] !== undefined) {
				pullReads.push(pullMatch[1]);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
			expect(pullReads).toContain("83");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a rejected GitHub project list is sent again on the next poll", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let projectReads = 0;
		let rejectNext = false;
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (
				urlOf(input) === "https://api.github.com/graphql" &&
				sent.includes("node(id:") &&
				!sent.includes("ProjectFields")
			) {
				projectReads += 1;
				if (rejectNext) {
					rejectNext = false;
					return new Response("recorded failure", { status: 500 });
				}
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const seeded = await fetch(new URL("/api/overview", base));
						expect(seeded.status).toBe(200);
						expect(await seeded.json()).toMatchObject({
							projects: [{ name: "Widget board", error: null }],
						});
						rejectNext = true;
						const failed = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(failed.status).toBe(204);
						const first = await fetch(new URL("/api/overview", base));
						expect(first.status).toBe(200);
						expect(await first.json()).toMatchObject({
							projects: [
								{
									name: "Widget board",
									error:
										"GitHub list project tickets failed (HTTP 500): PVT_widget (stale since 2026-10-18T12:00:00.000Z)",
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const second = await fetch(new URL("/api/overview", base));
						expect(second.status).toBe(200);
						expect(await second.json()).toMatchObject({
							projects: [
								{
									name: "Widget board",
									tracker: "github",
									inReview: 1,
									awaitingMerge: 0,
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(projectReads).toBe(3);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a second poll reads a progress comment added to the board", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const quiet = projectBoard([{ number: 83 }]);
		const progressed = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let projectReads = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (
				urlOf(input) === "https://api.github.com/graphql" &&
				sent.includes("ProjectItems")
			) {
				projectReads += 1;
			}
			return projectReads <= 1 ? quiet(input, init) : progressed(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const firstResponse = await fetch(new URL("/api/overview", base));
						expect(firstResponse.status).toBe(200);
						expect(await firstResponse.json()).toMatchObject({
							projects: [
								{
									name: "Widget board",
									inReview: 0,
									awaitingMerge: 1,
									tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
								},
							],
						});
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const secondResponse = await fetch(new URL("/api/overview", base));
						expect(secondResponse.status).toBe(200);
						expect(await secondResponse.json()).toMatchObject({
							projects: [
								{
									name: "Widget board",
									inReview: 1,
									awaitingMerge: 0,
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(projectReads).toBe(2);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closing pull in another repository still takes the workcell review state", async () => {
		const other = "acme/other";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [], [other]: [] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard(
			[{ number: 83, repo: other }],
			[
				{
					nodes: [{ number: 83, repository: { nameWithOwner: other } }],
					endCursor: null,
				},
			],
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/other/pull/83",
					),
					user: null,
				},
			],
		);
		const pullReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.includes(`/repos/${other}/pulls/`)) {
				pullReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
			expect(pullReads).toContain(
				`https://api.github.com/repos/${other}/pulls/83`,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("two tickets closed by one pull both take the workcell review state", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const progressBody = progress(
			"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
		);
		const board = projectBoard(
			[{ number: 83 }],
			undefined,
			[{ body: progressBody, user: null }],
			[
				{
					id: "I_widget_9",
					number: 9,
					title: "Ticket 9",
					pulls: [{ number: 83 }],
					comments: [{ body: progressBody, user: null }],
				},
			],
		);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 2,
						awaitingMerge: 0,
						tickets: [
							{ key: `${repo}#8`, state: "inReview" },
							{ key: `${repo}#9`, state: "inReview" },
						],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a newest-first Linear comment page still sets awaiting merge", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
								createdAt: "2026-10-03T00:00:00.000Z",
								user: { name: "Ada", displayName: "Ada Lovelace" },
							},
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
								createdAt: "2026-10-02T00:00:00.000Z",
								user: { name: "Ada", displayName: "Ada Lovelace" },
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentQueries: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				commentQueries.push(sent);
				return page({
					data: {
						issue: {
							comments: {
								nodes: [
									{
										body: "noted later",
										createdAt: "2026-10-04T00:00:00.000Z",
										user: { name: "Ada", displayName: "Ada Lovelace" },
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
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
			expect(commentQueries.every((body) => body.includes("displayName"))).toBe(
				true,
			);
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a board ticket with no open pull skips its comment read", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard(
			[{ number: 83 }],
			undefined,
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
					),
					user: null,
				},
			],
			[
				{
					id: "I_widget_9",
					number: 9,
					title: "Ticket 9",
					pulls: [],
					comments: [{ body: "no pull here", user: null }],
				},
			],
		);
		const commentReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.includes("/issues/") && url.includes("/comments")) {
				commentReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
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
			expect(await checks).toMatchObject({
				projects: [
					{
						inReview: 1,
						tickets: [
							{ key: `${repo}#8`, state: "inReview" },
							{ key: `${repo}#9`, state: "backlog" },
						],
					},
				],
			});
			expect(
				commentReads.some((url) => url.includes("/issues/8/comments")),
			).toBe(true);
			expect(
				commentReads.some((url) => url.includes("/issues/9/comments")),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
