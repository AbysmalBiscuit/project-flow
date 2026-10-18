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

function issue(
	number: number,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
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
		head: { ref: `pr-${number}` },
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
		if (url === pulls) {
			return page(recorded.pulls);
		}
		if (url === branches) {
			return page(recorded.branches ?? []);
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
		return new Response("not recorded", { status: 404 });
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
			return new Response("not recorded", { status: 404 });
		},
	});
}

describe("unlinked PRs", () => {
	test("a blank closing line leaves the PR unlinked", async () => {
		const body = await overview({
			issues: [issue(31)],
			pulls: [pull(91, { body: "   " })],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [
						{
							number: 91,
							title: "PR 91",
							url: "https://github.com/acme/widget/pull/91",
						},
					],
				},
			],
		});
	});

	test("an unlinked PR appears in the overview data", async () => {
		const body = await overview({
			issues: [issue(30)],
			pulls: [pull(90, { body: "A fix with no ticket." })],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [
						{
							number: 90,
							title: "PR 90",
							url: "https://github.com/acme/widget/pull/90",
						},
					],
				},
			],
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
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
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
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a dependabot branch links no ticket", async () => {
		const body = await overview({
			issues: [issue(4)],
			pulls: [],
			branches: [{ name: "dependabot/npm_and_yarn/zod-4.6.7" }],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a pushed branch makes its ticket in progress", async () => {
		const body = await overview({
			issues: [issue(21)],
			pulls: [],
			branches: [{ name: "21-feat-ship-the-widget" }],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a blank todo list leaves the ticket in backlog", async () => {
		const body = await overview({
			issues: [issue(23)],
			pulls: [],
			todos: "   \n",
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a bare ticket under another project heading stays in backlog", async () => {
		const body = await overview({
			issues: [issue(22)],
			pulls: [],
			todos: "## other/repo\n- [ ] Ticket 22 (#22, in progress)\n",
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a full key matches its ticket ignoring case", async () => {
		const body = await overview({
			issues: [issue(24)],
			pulls: [],
			todos: `- [ ] Ticket 24 (${repo.toUpperCase()}#24, in progress)\n`,
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a started devkit todo makes its ticket in progress", async () => {
		const body = await overview({
			issues: [issue(22)],
			pulls: [],
			todos: `## ${repo}\n- [ ] Ticket 22 (#22, in progress)\n`,
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
		});
	});
});

describe("PR links", () => {
	test("disclosed #5 links nothing", async () => {
		const body = await overview({
			issues: [issue(5)],
			pulls: [pull(55, { body: "disclosed #5", draft: true })],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
					inProgress: 0,
					unlinkedPrs: [
						{
							number: 55,
							title: "PR 55",
							url: `https://github.com/${repo}/pull/55`,
						},
					],
				},
			],
		});
	});

	test("a PR that closes a closed ticket is not unlinked", async () => {
		const body = await overview({
			issues: [issue(6, "closed")],
			pulls: [pull(56, { body: "Closes #6" })],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 1,
					dropped: 0,
					backlog: 0,
					inProgress: 0,
					unlinkedPrs: [],
				},
			],
		});
	});

	test("a closing reference links a recorded PR to its ticket", async () => {
		const body = await overview({
			issues: [issue(12)],
			pulls: [pull(40, { body: "Closes #12", draft: true })],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
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
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 0,
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
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
			expect(await checks).toEqual({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						done: 0,
						dropped: 0,
						backlog: 0,
						inProgress: 1,
						unlinkedPrs: [],
					},
				],
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
					head: { ref: "7-feat-link-prs-to-tickets" },
				}),
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
					inProgress: 1,
					unlinkedPrs: [],
				},
			],
		});
	});
});
