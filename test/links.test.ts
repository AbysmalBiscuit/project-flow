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
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";

function issue(
	number: number,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		body: "",
		updated_at: "2026-04-01T00:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

function view(
	number: number,
	state:
		| "backlog"
		| "inProgress"
		| "inReview"
		| "awaitingMerge"
		| "done"
		| "dropped",
): {
	key: string;
	title: string;
	state: string;
	blockers: string[];
	lane: string;
	statusType: string;
	enteredStateAt: string;
} {
	return {
		key: `${repo}#${number}`,
		title: `Ticket ${number}`,
		state,
		blockers: [],
		lane: laneOf(state),
		statusType: state,
		enteredStateAt: "2026-04-01T00:00:00Z",
	};
}

function laneOf(
	state:
		| "backlog"
		| "inProgress"
		| "inReview"
		| "awaitingMerge"
		| "done"
		| "dropped",
): string {
	if (state === "inProgress") {
		return "In progress";
	}
	if (state === "inReview") {
		return "In review";
	}
	if (state === "awaitingMerge") {
		return "Awaiting merge";
	}
	if (state === "done") {
		return "Done";
	}
	if (state === "dropped") {
		return "Dropped";
	}
	return "Backlog";
}

function pull(
	number: number,
	fields: Record<string, unknown>,
): Record<string, unknown> {
	return {
		number,
		title: `PR ${number}`,
		state: "open",
		draft: false,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `pr-${number}`, sha: `sha-${number}` },
		body: "",
		...fields,
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function githubFetch(
	recorded: {
		issues: Record<string, unknown>[];
		pulls: Record<string, unknown>[];
		linkedDevelopment?: { number: number }[];
		branches?: Record<string, unknown>[];
		todos?: string;
	},
	requests: string[] = [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		requests.push(url);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const issues = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
		const pulls = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`;
		const branches = `https://api.github.com/repos/${repo}/branches?per_page=100&page=1`;
		if (url === issues) {
			return page(recorded.issues);
		}
		if (url === pulls || url.includes("/pulls?state=closed")) {
			return url.includes("state=closed") ? page([]) : page(recorded.pulls);
		}
		if (url === branches) {
			return page(recorded.branches ?? []);
		}

		if (url.includes("check-runs") || url.includes("/commits/")) {
			return new Response(JSON.stringify({ check_runs: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.includes("/reactions")) {
			return page([]);
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		const pullMatch = url.match(/\/pulls\/(\d+)$/);
		if (pullMatch?.[1] !== undefined) {
			const found = recorded.pulls.find(
				(item) => item.number === Number(pullMatch[1]),
			);
			if (found !== undefined) {
				return new Response(JSON.stringify(found), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body);
			const nodes = recorded.linkedDevelopment ?? [];
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: {
								closingIssuesReferences: { nodes },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return unrecorded(input);
	};
}

async function overview(
	recorded: {
		issues: Record<string, unknown>[];
		pulls: Record<string, unknown>[];
		linkedDevelopment?: { number: number }[];
		branches?: Record<string, unknown>[];
		todos?: string;
	},
	requests: string[] = [],
): Promise<unknown> {
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
				fetch: githubFetch(recorded, requests),
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => startChecks(line),
				waitForStop: checks.then(() => undefined),
				...(recorded.todos === undefined
					? {}
					: { listTodos: async () => recorded.todos ?? "" }),
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

const linearProject = "widget-launch-0d42ae5d46d0";

function linearIssue(identifier: string): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		updatedAt: "2026-04-01T00:00:00.000Z",
		title: `Linear ticket ${identifier}`,
		state: { type: "unstarted" },
		attachments: {
			nodes: [
				{
					url: "https://github.com/acme/widget/pull/77",
					title: "fix: ship the launch",
					sourceType: "github",
				},
			],
		},
	};
}

function linearFetch(): Fetch {
	return linearFake({
		project: {
			id: "project-1",
			name: "Widget launch",
			slugId: linearProject,
		},
		issues: [linearIssue("WID-14")],
		github: async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.includes("/pulls?state=closed")) {
				return page([]);
			}
			if (url === "https://api.github.com/repos/acme/widget/pulls/77") {
				return new Response(
					JSON.stringify(
						pull(77, {
							body: "No keyword here.",
							draft: true,
							html_url: "https://github.com/acme/widget/pull/77",
						}),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/check-runs")) {
				return new Response(JSON.stringify({ check_runs: [] }), {
					status: 200,
				});
			}
			if (
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			return unrecorded(input);
		},
	});
}

describe("unlinked PRs", () => {
	test("a blank closing line leaves the PR unlinked", async () => {
		const body = await overview({
			issues: [issue(31)],
			pulls: [pull(91, { body: "   " })],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [
						{
							number: 91,
							title: "PR 91",
							url: "https://github.com/acme/widget/pull/91",
							repo,
						},
					],
					tickets: [view(31, "backlog")],
					crossProjectBlockers: [],
					needsYou: 1,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("an unlinked PR appears in the overview data", async () => {
		const body = await overview({
			issues: [issue(30)],
			pulls: [pull(90, { body: "A fix with no ticket." })],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [
						{
							number: 90,
							title: "PR 90",
							url: "https://github.com/acme/widget/pull/90",
							repo,
						},
					],
					tickets: [view(30, "backlog")],
					crossProjectBlockers: [],
					needsYou: 1,
					progress: 0,
				},
			],
			error: null,
		});
	});
});

describe("in progress", () => {
	test("a draft PR and a ready PR leave the ticket in progress", async () => {
		const body = await overview({
			issues: [issue(20)],
			pulls: [
				pull(52, { draft: true, body: "Closes #20" }),
				pull(53, { draft: false, body: "Closes #20" }),
			],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(20, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a draft PR makes its ticket in progress", async () => {
		const body = await overview({
			issues: [issue(18), issue(19)],
			pulls: [
				pull(50, { draft: true, body: "Closes #18" }),
				pull(51, { draft: false, body: "Closes #19" }),
			],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 1,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(18, "inProgress"), view(19, "awaitingMerge")],
					crossProjectBlockers: [],
					needsYou: 1,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a dependabot branch links no ticket", async () => {
		const body = await overview({
			issues: [issue(4)],
			pulls: [],
			branches: [{ name: "dependabot/npm_and_yarn/zod-4.6.7" }],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(4, "backlog")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a pushed branch makes its ticket in progress", async () => {
		const body = await overview({
			issues: [issue(21)],
			pulls: [],
			branches: [{ name: "21-feat-ship-the-widget" }],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(21, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a blank todo list leaves the ticket in backlog", async () => {
		const body = await overview({
			issues: [issue(23)],
			pulls: [],
			todos: "   \n",
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(23, "backlog")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a bare ticket under another project heading stays in backlog", async () => {
		const body = await overview({
			issues: [issue(22)],
			pulls: [],
			todos: "## other/repo\n- [ ] Ticket 22 (#22, in progress)\n",
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(22, "backlog")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a full key matches its ticket ignoring case", async () => {
		const body = await overview({
			issues: [issue(24)],
			pulls: [],
			todos: `- [ ] Ticket 24 (${repo.toUpperCase()}#24, in progress)\n`,
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(24, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a started devkit todo makes its ticket in progress", async () => {
		const body = await overview({
			issues: [issue(22)],
			pulls: [],
			todos: `## ${repo}\n- [ ] Ticket 22 (#22, in progress)\n`,
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(22, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});
});

describe("PR links", () => {
	test("disclosed #5 links nothing", async () => {
		const body = await overview({
			issues: [issue(5)],
			pulls: [pull(55, { body: "disclosed #5", draft: true })],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [
						{
							number: 55,
							title: "PR 55",
							url: `https://github.com/${repo}/pull/55`,
							repo,
						},
					],
					tickets: [view(5, "backlog")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a PR that closes a closed ticket is not unlinked", async () => {
		const body = await overview({
			issues: [issue(6, "closed")],
			pulls: [pull(56, { body: "Closes #6" })],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 1,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(6, "done")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 100,
				},
			],
			error: null,
		});
	});

	test("a closing reference links a recorded PR to its ticket", async () => {
		const body = await overview({
			issues: [issue(12)],
			pulls: [pull(40, { body: "Closes #12", draft: true })],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(12, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("the linked-development field links a recorded PR to its ticket", async () => {
		const requests: string[] = [];
		const body = await overview(
			{
				issues: [issue(14)],
				pulls: [pull(41, { body: "No keyword here.", draft: true })],
				linkedDevelopment: [{ number: 14 }],
			},
			requests,
		);
		const sent = requests.find((item) => item.includes("userLinkedOnly"));
		expect(sent).toBeDefined();
		expect(sent).toContain("closingIssuesReferences");
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(14, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});

	test("a Linear PR attachment links a recorded PR to its ticket", async () => {
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
					.then(async (response) => resolve(await response.json()))
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
					fetch: linearFetch(),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 1,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-14",
								title: "Linear ticket WID-14",
								state: "inProgress",
								blockers: [],
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
					},
				],
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a branch name links a recorded PR to its ticket", async () => {
		const body = await overview({
			issues: [issue(7)],
			pulls: [
				pull(42, {
					body: "No keyword here.",
					draft: true,
					head: { ref: "7-feat-link-prs-to-tickets", sha: "sha-42" },
				}),
			],
		});
		expect(body).toMatchObject({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					tags: [],
					unlinkedPrs: [],
					tickets: [view(7, "inProgress")],
					crossProjectBlockers: [],
					needsYou: 0,
					progress: 0,
				},
			],
			error: null,
		});
	});
});
