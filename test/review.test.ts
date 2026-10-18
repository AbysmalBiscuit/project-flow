import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo, urlOf } from "./support.ts";

const repo = "acme/widget";
const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const codex = "chatgpt-codex-connector[bot]";
const grok = "grok-code-review[bot]";
const greptile = "greptile-apps[bot]";

function issue(number: number): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

function pull(number: number, ticket = 8, sha = head): Record<string, unknown> {
	return {
		number,
		title: `PR ${number}`,
		state: "open",
		draft: false,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `${number}-feat-review`, sha },
		body: `Closes #${ticket}`,
		merged_at: null,
	};
}

function mergedPull(bots: Record<string, unknown>[]): Record<string, unknown> {
	return {
		number: 1,
		title: "merged",
		state: "closed",
		draft: false,
		html_url: `https://github.com/${repo}/pull/1`,
		head: { ref: "1-merged", sha: older },
		body: "",
		merged_at: "2026-10-01T00:00:00Z",
		history: bots,
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
	reviewDecision: string | null;
	mergedPulls?: Record<string, unknown>[];
}): Fetch {
	return async (input, init) => {
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
			return page(recorded.mergedPulls ?? []);
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
		const thread = url.match(
			/\/(?:issues|pulls)\/(\d+)\/(comments|reviews|reactions)/,
		);
		if (thread?.[1] !== undefined && thread[2] !== undefined) {
			const number = Number(thread[1]);
			const history = (recorded.mergedPulls ?? []).find(
				(item) => item.number === number,
			)?.history;
			const recordedRows =
				thread[2] === "comments"
					? recorded.commentsByPull[number]
					: thread[2] === "reviews"
						? recorded.reviewsByPull[number]
						: recorded.reactionsByPull[number];
			const fromHistory = Array.isArray(history)
				? history.filter((item) => {
						if (thread[2] === "reviews") {
							return "commit_id" in item;
						}
						if (thread[2] === "reactions") {
							return "content" in item;
						}
						return "body" in item && !("commit_id" in item);
					})
				: undefined;
			const rows = recordedRows ?? fromHistory;
			return page(rows ?? []);
		}
		const pullMatch = url.match(/\/pulls\/(\d+)$/);
		if (pullMatch?.[1] !== undefined) {
			const number = Number(pullMatch[1]);
			const found = [...recorded.pulls, ...(recorded.mergedPulls ?? [])].find(
				(item) => item.number === number,
			);
			return found === undefined
				? new Response("not recorded", { status: 404 })
				: page(found);
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			if (body.includes("reviewDecision")) {
				return page({
					data: {
						repository: {
							pullRequest: { reviewDecision: recorded.reviewDecision },
						},
					},
				});
			}
			return page({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			});
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function overview(recorded: {
	issues: Record<string, unknown>[];
	pulls: Record<string, unknown>[];
	checksBySha?: Record<string, Record<string, unknown>[]>;
	commentsByPull?: Record<number, Record<string, unknown>[]>;
	reviewsByPull?: Record<number, Record<string, unknown>[]>;
	reactionsByPull?: Record<number, Record<string, unknown>[]>;
	reviewDecision?: string | null;
	mergedPulls?: Record<string, unknown>[];
	config?: string;
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
				fetch: githubFetch({
					issues: recorded.issues,
					pulls: recorded.pulls,
					checksBySha: recorded.checksBySha ?? {},
					commentsByPull: recorded.commentsByPull ?? {},
					reviewsByPull: recorded.reviewsByPull ?? {},
					reactionsByPull: recorded.reactionsByPull ?? {},
					reviewDecision: recorded.reviewDecision ?? null,
					mergedPulls: recorded.mergedPulls ?? [],
				}),
				readGhToken: async () => null,
				databasePath,
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
	test("a PR merged over a changes-requested bot review is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(83)],
			reviewDecision: "CHANGES_REQUESTED",
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
				83: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
			mergedPulls: [
				mergedPull([
					{
						user: { login: grok },
						commit_id: older,
						state: "COMMENTED",
						body: "",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a finished Grok review on the head commit is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(85)],
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
				85: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: grok },
						commit_id: older,
						state: "COMMENTED",
						body: "",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
				86: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: grok },
						commit_id: older,
						state: "COMMENTED",
						body: "",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a Greptile summary with no running check is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(87)],
			commentsByPull: {
				87: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->\nConfidence Score: 5/5",
					},
				],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
				88: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
			mergedPulls: [
				mergedPull([
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: ["greptile skipped"],
					unlinkedPrs: [],
				},
			],
		});
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
			mergedPulls: [mergedPull([])],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: ["grok cancelled"],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a Codex review that left only a reaction is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(82)],
			reactionsByPull: { 82: [{ user: { login: codex }, content: "+1" }] },
			mergedPulls: [
				mergedPull([
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a Codex in-progress reaction keeps the PR in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(90)],
			reactionsByPull: { 90: [{ user: { login: codex }, content: "eyes" }] },
			commentsByPull: {
				90: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("expected bots come from recorded merged PRs", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			mergedPulls: [
				mergedPull([
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
						reviewDecision: null,
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
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
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
			mergedPulls: [
				mergedPull([
					{
						user: { login: grok },
						commit_id: older,
						state: "COMMENTED",
						body: "",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: ["grok failure"],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a configuration override wins over detected expected bots", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(92)],
			mergedPulls: [
				mergedPull([
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				]),
			],
			config: JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [] },
			}),
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a Codex usage-limit comment is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(81)],
			commentsByPull: {
				81: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
					},
				],
			},
			mergedPulls: [
				mergedPull([
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				]),
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
					tags: ["codex usage limit"],
					unlinkedPrs: [],
				},
			],
		});
	});
});
