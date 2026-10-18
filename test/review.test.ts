import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
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
): {
	projects: {
		name: string;
		tracker: "github";
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
		tags: string[];
		unlinkedPrs: [];
		tickets: {
			key: string;
			title: string;
			state: string;
			blockers: [];
		}[];
		crossProjectBlockers: [];
	}[];
} {
	return {
		projects: [
			{
				name: repo,
				tracker: "github",
				done: 0,
				dropped: 0,
				blocked: 0,
				...counts,
				tags,
				unlinkedPrs: [],
				tickets: [
					{
						key: `${repo}#8`,
						title: "Ticket 8",
						state,
						blockers: [],
					},
				],
				crossProjectBlockers: [],
			},
		],
	};
}

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
		const thread = url.match(
			/\/(?:issues|pulls)\/(\d+)\/(comments|reviews|reactions)\?per_page=100&page=(\d+)/,
		);
		if (thread?.[1] !== undefined && thread[2] !== undefined) {
			const number = Number(thread[1]);
			const rows =
				(thread[2] === "comments"
					? recorded.commentsByPull[number]
					: thread[2] === "reviews"
						? recorded.reviewsByPull[number]
						: recorded.reactionsByPull[number]) ?? [];
			const pageNumber = Number(thread[3]);
			const start = (pageNumber - 1) * 100;
			const slice = rows.slice(start, start + 100);
			const headers = new Headers({ "content-type": "application/json" });
			if (start + 100 < rows.length) {
				const next = url.replace(`page=${thread[3]}`, `page=${pageNumber + 1}`);
				headers.set("link", `<${next}>; rel="next"`);
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
	mergedPulls?: Record<string, unknown>[];
	closedNext?: string | null;
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
					mergedPulls: recorded.mergedPulls ?? [],
					...(recorded.closedNext === undefined
						? {}
						: { closedNext: recorded.closedNext }),
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
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				85: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
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
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
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
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
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

	test("a merged PR does not move an open ticket", async () => {
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
		expect(body).toEqual(
			card("backlog", {
				backlog: 1,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 0,
			}),
		);
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

	test("a Linear expected-bot override wins", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [linearProject]: [] },
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
				if (url.includes("/commits/") && url.endsWith("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (
					url.includes("/comments?") ||
					url.includes("/reviews?") ||
					url.includes("/reactions?")
				) {
					return page([]);
				}
				return new Response("not recorded", { status: 404 });
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
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 1,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-8",
								title: "Linear ticket 8",
								state: "awaitingMerge",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
					},
				],
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
});
