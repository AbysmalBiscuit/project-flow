import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import outsideRelations from "./fixtures/outside-relations.json";
import {
	emptyProjectFields,
	githubIssueNode,
	linearFake,
	recordedDiscovery,
	repoReadFromLists,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "AbysmalBiscuit/devkit";

function issue(
	number: number,
	body: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: "2026-04-01T00:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
		body,
		comments_url: `https://api.github.com/repos/${repo}/issues/${number}/comments`,
	};
}

const recorded = [
	issue(404, ""),
	issue(405, ""),
	issue(188, ""),
	issue(220, ""),
	issue(408, ""),
	issue(409, ""),
	issue(410, ""),
	issue(411, ""),
	issue(412, ""),
	issue(600, "Closed.", "closed"),
	issue(
		420,
		"Blocked by: https://github.com/AbysmalBiscuit/devkit/issues/404, https://github.com/AbysmalBiscuit/devkit/issues/405",
	),
	issue(421, "Blocked by: #188"),
	issue(422, "Blocked by: #188, #220"),
	issue(423, "Blocked by: #188."),
	issue(424, "Blocked by: none"),
	issue(425, "Blocked by: none."),
	issue(426, "Blocks: #408"),
	issue(427, "Blocking: #409"),
	issue(428, "**Blocked by:** #410"),
	issue(429, "- Blocked by: #411"),
	issue(430, "blocked by #412"),
	issue(431, "The body has no blocker line."),
	issue(432, "Blocked by: #600"),
	issue(433, "Blocked by:   "),
	issue(434, "Blocked by: #188,  #220"),
	issue(435, ""),
];

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function recordedFetch(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const listed = repoReadFromLists(input, init, { [repo]: recorded });
		if (listed !== null) {
			return listed;
		}
		const list = `https://api.github.com/repos/${repo}/issues?`;
		if (url.startsWith(list) && url.includes("state=all")) {
			return page(recorded);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		const comments = url.match(/\/issues\/(\d+)\/comments$/);
		if (comments?.[1] !== undefined) {
			const number = Number(comments[1]);
			if (number === 424 || number === 431) {
				return page([
					{
						id: number,
						body: "Blocked by: #188",
						html_url: `${url}#issuecomment-1`,
					},
				]);
			}
			return page([]);
		}
		return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
	};
}

function blockersOf(
	tickets: { key: string; state: string; blockers: string[] }[],
	key: string,
): { state: string; blockers: string[] } {
	const ticket = tickets.find((item) => item.key === key);
	if (ticket === undefined) {
		throw new Error(`missing ticket ${key}`);
	}
	return { state: ticket.state, blockers: ticket.blockers };
}

const linearProject = "widget-launch";

function linearIssue(
	identifier: string,
	description: string,
	stateType = "unstarted",
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title: `Linear ${identifier}`,
		description,
		updatedAt: "2026-04-01T00:00:00.000Z",
		state: { type: stateType },
		inverseRelations: { nodes: [] },
	};
}

describe("GET /api/overview blockers", () => {
	test("body lines name blockers, and none, punctuation and comments name none", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = overview.projects[0];
						expect(project?.name).toBe(repo);
						const tickets = project?.tickets ?? [];
						const key = (number: number) => `${repo}#${number}`;
						expect(blockersOf(tickets, key(420))).toEqual({
							state: "backlog",
							blockers: [key(404), key(405)],
						});
						expect(blockersOf(tickets, key(421))).toEqual({
							state: "backlog",
							blockers: [key(188)],
						});
						expect(blockersOf(tickets, key(422))).toEqual({
							state: "backlog",
							blockers: [key(188), key(220)],
						});
						expect(blockersOf(tickets, key(423))).toEqual({
							state: "backlog",
							blockers: [key(188)],
						});
						expect(blockersOf(tickets, key(424))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(425))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(408))).toEqual({
							state: "backlog",
							blockers: [key(426)],
						});
						expect(blockersOf(tickets, key(426)).blockers).toEqual([]);
						expect(blockersOf(tickets, key(427))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(409))).toEqual({
							state: "backlog",
							blockers: [key(427)],
						});
						expect(blockersOf(tickets, key(428))).toEqual({
							state: "backlog",
							blockers: [key(410)],
						});
						expect(blockersOf(tickets, key(429))).toEqual({
							state: "backlog",
							blockers: [key(411)],
						});
						expect(blockersOf(tickets, key(430))).toEqual({
							state: "backlog",
							blockers: [key(412)],
						});
						expect(blockersOf(tickets, key(431))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(432))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(433))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(434))).toEqual({
							state: "backlog",
							blockers: [key(188), key(220)],
						});
						expect(blockersOf(tickets, key(435))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(project?.blocked).toBe(10);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blocker line links a Linear ticket to a GitHub ticket", async () => {
		const githubRepo = "AbysmalBiscuit/workcell";
		const linearKey = "SWE-12632";
		const outside = "AbysmalBiscuit/factory";
		const githubIssues = [
			issue(151, "Open GitHub ticket."),
			issue(
				153,
				`Blocked by: https://linear.app/adaptyv-bio/issue/${linearKey}/keep-a-plugin-bootstraps-state`,
			),
			issue(154, `Blocked by: ${outside}#220`),
		].map((item) => ({
			...item,
			html_url: `https://github.com/${githubRepo}/issues/${String(item.number)}`,
			comments_url: `https://api.github.com/repos/${githubRepo}/issues/${String(item.number)}/comments`,
		}));
		const outsideIssues = [
			{
				...issue(220, "Open ticket in another repo."),
				html_url: `https://github.com/${outside}/issues/220`,
			},
		];
		const linearIssues = [
			linearIssue(linearKey, `Blocks: ${githubRepo}#153`, "started"),
			linearIssue("SWE-1", "Blocked by: none.", "unstarted"),
		];
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: linearIssues,
			github: async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				const list = `https://api.github.com/repos/${githubRepo}/issues?`;
				const outsideList = `https://api.github.com/repos/${outside}/issues?`;
				if (url.startsWith(list) && url.includes("state=all")) {
					return page(githubIssues);
				}
				if (url.startsWith(outsideList) && url.includes("state=all")) {
					return page(outsideIssues);
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				if (url.includes("/comments")) {
					return page([]);
				}
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			},
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: outside },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
								crossProjectBlockers: {
									project: string;
									tracker: string;
									key: string;
									title: string;
								}[];
							}[];
						};
						const github = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						const linear = overview.projects.find(
							(project) => project.name === linearProject,
						);
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#153`),
						).toEqual({
							state: "backlog",
							blockers: [linearKey],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#154`),
						).toEqual({
							state: "backlog",
							blockers: [`${outside}#220`],
						});
						expect(blockersOf(linear?.tickets ?? [], linearKey)).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(github?.crossProjectBlockers).toEqual([
							{
								project: linearProject,
								tracker: "linear",
								key: linearKey,
								title: `Linear ${linearKey}`,
							},
							{
								project: outside,
								tracker: "github",
								key: `${outside}#220`,
								title: "Ticket 220",
							},
						]);
						expect(github?.blocked).toBe(2);
						expect(linear?.blocked).toBe(0);
						resolve();
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
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a native GitHub dependency and a native Linear relation are blockers", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const requests: string[] = [];
		const nativeNodes = [
			{
				...githubIssueNode(issue(373, "Body names nobody.")),
				blockedBy: {
					nodes: [
						{
							number: 372,
							title: "The native blocker.",
							state: "OPEN",
							repository: { nameWithOwner: githubRepo },
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
			githubIssueNode(issue(372, "The native blocker.")),
			{
				...githubIssueNode(issue(374, "Closed native blocker is not open.")),
				blockedBy: {
					nodes: [
						{
							number: 9,
							title: null,
							state: "CLOSED",
							repository: { nameWithOwner: "acme/other" },
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		];
		const recordedFetch = linearFake({
			requests,
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [
				{
					...linearIssue("SWE-13252", "", "unstarted"),
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									identifier: "SWE-13234",
									title: "Open Linear blocker",
									state: { type: "started" },
									project: { slugId: linearProject },
								},
							},
							{
								type: "related",
								issue: {
									identifier: "SWE-9",
									title: "Related, not a blocker",
									state: { type: "started" },
									project: { slugId: linearProject },
								},
							},
							{
								type: "blocks",
								issue: {
									identifier: "SWE-8",
									title: "Completed blocker in another project",
									state: { type: "completed" },
									project: { slugId: "other-project" },
								},
							},
						],
					},
				},
				linearIssue("SWE-13234", "", "started"),
				linearIssue("SWE-9", "", "started"),
			],
			github: async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				requests.push(url);
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					requests.push(
						`https://api.github.com/repos/${githubRepo}/issues/373/dependencies/blocked_by?per_page=100&page=1`,
						`https://api.github.com/repos/${githubRepo}/issues/374/dependencies/blocked_by?per_page=100&page=1`,
					);
					return new Response(
						JSON.stringify(
							repoReadIssues("AbysmalBiscuit", "devkit", nativeNodes),
						),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				const list = `https://api.github.com/repos/${githubRepo}/issues?`;
				if (url.startsWith(list) && url.includes("state=all")) {
					return page([
						{
							...issue(373, "Body names nobody."),
							issue_dependencies_summary: {
								blocked_by: 1,
								blocking: 0,
								total_blocked_by: 1,
								total_blocking: 0,
							},
						},
						issue(372, "The native blocker."),
						{
							...issue(374, "Closed native blocker is not open."),
							issue_dependencies_summary: {
								blocked_by: 1,
								blocking: 0,
								total_blocked_by: 1,
								total_blocking: 0,
							},
						},
					]);
				}
				const dependencies = `https://api.github.com/repos/${githubRepo}/issues/373/dependencies/blocked_by?per_page=100&page=1`;
				const closedNative = `https://api.github.com/repos/${githubRepo}/issues/374/dependencies/blocked_by?per_page=100&page=1`;
				if (url === closedNative) {
					return page([
						{
							number: 9,
							state: "closed",
							repository_url: "https://api.github.com/repos/acme/other",
						},
					]);
				}
				if (url === dependencies) {
					return page([
						{
							number: 372,
							state: "open",
							html_url: `https://github.com/${githubRepo}/issues/372`,
							repository_url: `https://api.github.com/repos/${githubRepo}`,
							title: "The native blocker.",
						},
					]);
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			},
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const fetching: Fetch = recordedFetch;
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const github = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						const linear = overview.projects.find(
							(project) => project.name === linearProject,
						);
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#373`),
						).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#372`],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#372`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#374`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(linear?.tickets ?? [], "SWE-13252")).toEqual({
							state: "backlog",
							blockers: ["SWE-13234"],
						});
						expect(blockersOf(linear?.tickets ?? [], "SWE-13234")).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(requests.some((url) => url.endsWith("/comments"))).toBe(
							false,
						);
						expect(
							requests.filter((url) =>
								url.includes("/dependencies/blocked_by"),
							),
						).toEqual([
							`https://api.github.com/repos/${githubRepo}/issues/373/dependencies/blocked_by?per_page=100&page=1`,
							`https://api.github.com/repos/${githubRepo}/issues/374/dependencies/blocked_by?per_page=100&page=1`,
						]);
						resolve();
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
					fetch: fetching,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("bold and underscore body lines yield blockers", async () => {
		const recordedFetch: Fetch = async (input, init) => {
			const body = typeof init?.body === "string" ? init.body : "";
			if (
				urlOf(input) === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				return new Response(
					JSON.stringify(
						repoReadIssues("AbysmalBiscuit", "devkit", [
							githubIssueNode(issue(3, "Open.")),
							githubIssueNode(issue(4, "Open.")),
							githubIssueNode(issue(70, "**Blocked by**: #3")),
							githubIssueNode(issue(71, "__Blocks__: #4")),
						]),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const list = `https://api.github.com/repos/${repo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					issue(3, "Open."),
					issue(4, "Open."),
					issue(70, "**Blocked by**: #3"),
					issue(71, "__Blocks__: #4"),
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const tickets = overview.projects[0]?.tickets ?? [];
						const key = (number: number) => `${repo}#${number}`;
						expect(blockersOf(tickets, key(70))).toEqual({
							state: "backlog",
							blockers: [key(3)],
						});
						expect(blockersOf(tickets, key(4))).toEqual({
							state: "backlog",
							blockers: [key(71)],
						});
						expect(blockersOf(tickets, key(71)).blockers).toEqual([]);
						expect(overview.projects[0]?.blocked).toBe(2);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank marker, a repeated space and a closed outside relation yield no blocker", async () => {
		const githubRepo = "acme/widget";
		const unloaded = "acme/outside";
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [
				{
					...linearIssue("SWE-50", "  **Blocked by**:   ", "unstarted"),
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									identifier: "SWE-8",
									title: "Closed issue in an unpinned project",
									state: { type: "completed" },
									project: { slugId: "unpinned-project" },
								},
							},
						],
					},
				},
				linearIssue("SWE-51", "**Blocked by**:", "unstarted"),
				linearIssue("SWE-52", "__Blocks__:   ", "unstarted"),
			],
			github: async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				const list = `https://api.github.com/repos/${githubRepo}/issues?`;
				if (url.startsWith(list) && url.includes("state=all")) {
					return page([
						{
							...issue(90, "Depends on a closed issue in an unloaded repo."),
							html_url: `https://github.com/${githubRepo}/issues/90`,
							comments_url: `https://api.github.com/repos/${githubRepo}/issues/90/comments`,
							issue_dependencies_summary: {
								blocked_by: 1,
								blocking: 0,
								total_blocked_by: 1,
								total_blocking: 0,
							},
						},
						{
							...issue(91, "**Blocked by**:  #92"),
							html_url: `https://github.com/${githubRepo}/issues/91`,
							comments_url: `https://api.github.com/repos/${githubRepo}/issues/91/comments`,
						},
						{
							...issue(92, "Open."),
							html_url: `https://github.com/${githubRepo}/issues/92`,
							comments_url: `https://api.github.com/repos/${githubRepo}/issues/92/comments`,
						},
						{
							...issue(93, "Depends on an issue with no recorded state."),
							html_url: `https://github.com/${githubRepo}/issues/93`,
							comments_url: `https://api.github.com/repos/${githubRepo}/issues/93/comments`,
							issue_dependencies_summary: {
								blocked_by: 1,
								blocking: 0,
								total_blocked_by: 1,
								total_blocking: 0,
							},
						},
					]);
				}
				if (url.includes("/issues/90/dependencies/blocked_by")) {
					return page([
						{
							number: 7,
							state: "closed",
							repository_url: `https://api.github.com/repos/${unloaded}`,
						},
					]);
				}
				if (url.includes("/issues/93/dependencies/blocked_by")) {
					return page([
						{
							number: 8,
							state: "merged",
							repository_url: `https://api.github.com/repos/${unloaded}`,
						},
					]);
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				if (url.includes("/comments")) {
					return page([]);
				}
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			},
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const github = overview.projects.find(
							(item) => item.name === githubRepo,
						);
						const linear = overview.projects.find(
							(item) => item.name === linearProject,
						);
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#90`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#91`),
						).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#92`],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#93`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(linear?.tickets ?? [], "SWE-50")).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(linear?.tickets ?? [], "SWE-51")).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(linear?.tickets ?? [], "SWE-52")).toEqual({
							state: "backlog",
							blockers: [],
						});
						resolve();
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
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an open GitHub dependency in an unloaded repo stays a blocker", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const unloaded = "acme/outside";
		const recordedFetch: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(80, "Depends on an issue the app does not load."),
						issue_dependencies_summary: {
							blocked_by: 1,
							blocking: 0,
							total_blocked_by: 1,
							total_blocking: 0,
						},
					},
					issue(81, "Open in the loaded repo."),
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${githubRepo}/issues/80/dependencies/blocked_by?per_page=100&page=1`
			) {
				return page([
					{
						number: 9,
						state: "open",
						html_url: `https://github.com/${unloaded}/issues/9`,
						repository_url: `https://api.github.com/repos/${unloaded}`,
						title: "Open issue in an unloaded repo",
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
								crossProjectBlockers: {
									project: string;
									tracker: string;
									key: string;
									title: string;
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === githubRepo,
						);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#80`),
						).toEqual({
							state: "backlog",
							blockers: [`${unloaded}#9`],
						});
						expect(project?.blocked).toBe(1);
						expect(project?.crossProjectBlockers).toEqual([
							{
								project: unloaded,
								tracker: "github",
								key: `${unloaded}#9`,
								title: "Open issue in an unloaded repo",
							},
						]);
						expect(
							overview.projects.some((item) => item.name === unloaded),
						).toBe(false);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an open Linear blocker in an unpinned project stays a blocker", async () => {
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [
				{
					...linearIssue("SWE-40", "", "unstarted"),
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									identifier: "SWE-3",
									title: "Open issue in an unpinned project",
									state: { type: "started" },
									project: {
										slugId: "unpinned-project",
										name: "Unpinned",
									},
								},
							},
						],
					},
				},
			],
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
								crossProjectBlockers: {
									project: string;
									tracker: string;
									key: string;
									title: string;
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === linearProject,
						);
						expect(blockersOf(project?.tickets ?? [], "SWE-40")).toEqual({
							state: "backlog",
							blockers: ["SWE-3"],
						});
						expect(project?.blocked).toBe(1);
						expect(project?.crossProjectBlockers).toEqual([
							{
								project: "Unpinned",
								tracker: "linear",
								key: "SWE-3",
								title: "Open issue in an unpinned project",
							},
						]);
						expect(
							overview.projects.some(
								(item) => item.name === "unpinned-project",
							),
						).toBe(false);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank outside title and a missing project name fall back to the key and slug", async () => {
		const recorded = outsideRelations.linearOps3838;
		const relation = recorded.inverseRelations.nodes.find(
			(item) => item.type === "blocks",
		);
		if (relation === undefined || relation.issue.project !== null) {
			throw new Error("recorded OPS-3838 has no null-project blocks relation");
		}
		const slugOnly = "bare-slug";
		const requests: string[] = [];
		const sent: {
			url: string;
			query: string;
			variables: Record<string, unknown>;
		}[] = [];
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [
				{
					...linearIssue(recorded.identifier, "", "unstarted"),
					title: recorded.title,
					updatedAt: recorded.updatedAt,
					state: recorded.state,
					inverseRelations: {
						nodes: [
							{
								...relation,
								issue: {
									...relation.issue,
									title: "   ",
									project: { slugId: slugOnly },
								},
							},
						],
					},
				},
			],
			requests,
			sent,
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								crossProjectBlockers: {
									project: string;
									tracker: string;
									key: string;
									title: string;
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === linearProject,
						);
						expect(project?.crossProjectBlockers).toEqual([
							{
								project: slugOnly,
								tracker: "linear",
								key: relation.issue.identifier,
								title: relation.issue.identifier,
							},
						]);
						const issueReads = sent.filter((request) =>
							request.query.includes("ProjectIssues"),
						);
						expect(issueReads.length).toBeGreaterThan(0);
						expect(issueReads[0]?.query).toContain("inverseRelations");
						expect(issueReads[0]?.query).toContain("title");
						expect(issueReads[0]?.query).toContain("project { name slugId }");
						expect(issueReads[0]?.variables).toEqual(
							expect.objectContaining({
								filter: { project: { id: { eq: "project-widget" } } },
							}),
						);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank body, a prose mention and a closed native blocker yield none", async () => {
		const requests: string[] = [];
		const githubRepo = "acme/widget";
		const recordedFetch: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			requests.push(url);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{ ...issue(1, ""), body: null },
					issue(2, "This ticket is blocked by the release, with no ref."),
					issue(3, "Blocked by: none, #9"),
					issue(5, "Blocks of code in #9 need a rewrite."),
					issue(6, "Blocked by: #77"),
					issue(7, "Blocked by:   "),
					issue(10, "Blocked by: #9."),
					issue(11, "Blocked by: https://github.com/acme/widget/pull/12"),
					{
						...issue(4, ""),
						issue_dependencies_summary: {
							blocked_by: 0,
							blocking: 0,
							total_blocked_by: 1,
							total_blocking: 0,
						},
					},
					issue(9, "Open."),
					issue(8, "Closed native blocker.", "closed"),
				]);
			}
			if (url.includes("/issues/4/dependencies/blocked_by")) {
				return page([
					{
						number: 8,
						state: "closed",
						html_url: `https://github.com/${githubRepo}/issues/8`,
						repository_url: `https://api.github.com/repos/${githubRepo}`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						const overview = (await response.json()) as {
							projects: {
								blocked: number;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const tickets = overview.projects[0]?.tickets ?? [];
						const key = (number: number) => `${githubRepo}#${number}`;
						expect(blockersOf(tickets, key(1)).blockers).toEqual([]);
						expect(blockersOf(tickets, key(2)).blockers).toEqual([]);
						expect(blockersOf(tickets, key(3))).toEqual({
							state: "backlog",
							blockers: [key(9)],
						});
						expect(blockersOf(tickets, key(5))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(9))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(6))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(10))).toEqual({
							state: "backlog",
							blockers: [key(9)],
						});
						expect(blockersOf(tickets, key(11))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(4))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(overview.projects[0]?.blocked).toBe(2);
						expect(
							requests.filter((url) => url.includes("query RepoRead")),
						).toEqual([]);
						expect(
							requests.filter((url) => url === "https://api.github.com/graphql")
								.length,
						).toBeGreaterThan(0);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GitHub project ticket shows its blocker on the project card", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const projectId = "PVT_widget";
		const board = "Widget board";
		const requests: string[] = [];
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(`${url} ${body}`);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: projectId,
								number: 3,
								title: board,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_body",
											number: 21,
											title: "Waits on a body line",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "Blocked by: #20",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_native",
											number: 22,
											title: "Waits on a native dependency",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "No body line.",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: {
												nodes: [
													{
														number: 20,
														state: "OPEN",
														repository: { nameWithOwner: githubRepo },
													},
												],
											},
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_shared",
											number: 23,
											title: "Sits on the repo and the project",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_blank",
											number: 24,
											title: "Blank body and a closed dependency",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "   ",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: {
												nodes: [
													{
														number: 19,
														state: "CLOSED",
														repository: { nameWithOwner: githubRepo },
													},
												],
											},
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_spaced",
											number: 26,
											title: "Repeated spaces in a body line",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "Blocked by:   #20",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_plain",
											number: 25,
											title: "No dependency field",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "Blocked by: none.",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_blocker",
											number: 20,
											title: "Open blocker",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(23, "Blocked by: #20"),
						html_url: `https://github.com/${githubRepo}/issues/23`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/23/comments`,
					},
					{
						...issue(20, "Open blocker."),
						html_url: `https://github.com/${githubRepo}/issues/20`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/20/comments`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 3 },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === board,
						);
						const key = `${githubRepo}#20`;
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#21`),
						).toEqual({
							state: "backlog",
							blockers: [key],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#22`),
						).toEqual({
							state: "backlog",
							blockers: [key],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#23`),
						).toEqual({
							state: "backlog",
							blockers: [key],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#24`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#25`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#26`),
						).toEqual({
							state: "backlog",
							blockers: [key],
						});
						const projectItems = requests.find((sent) =>
							sent.includes("ProjectItems"),
						);
						expect(projectItems).toContain("body");
						expect(projectItems).toContain("blockedBy");
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a later poll drops a blocker the tracker no longer returns", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		let listReads = 0;
		let now = Date.parse("2026-08-18T12:00:00.000Z");
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				listReads += 1;
				const cleared = listReads > 1;
				return page([
					{
						...issue(21, cleared ? "" : "Blocked by: #20"),
						html_url: `https://github.com/${githubRepo}/issues/21`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/21/comments`,
						updated_at: cleared
							? "2026-08-18T13:00:00Z"
							: "2026-08-18T12:00:00Z",
						issue_dependencies_summary: {
							blocked_by: cleared ? 0 : 1,
							total_blocked_by: 1,
						},
					},
					{
						...issue(20, "Open blocker."),
						html_url: `https://github.com/${githubRepo}/issues/20`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/20/comments`,
						state: cleared ? "closed" : "open",
						state_reason: cleared ? "completed" : null,
						updated_at: cleared
							? "2026-08-18T13:00:00Z"
							: "2026-08-18T12:00:00Z",
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=1`
			) {
				return page([
					{
						number: 20,
						state: listReads > 1 ? "closed" : "open",
						repository_url: `https://api.github.com/repos/${githubRepo}`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				const key = `${githubRepo}#21`;
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const first = (await response.json()) as {
							projects: {
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						expect(blockersOf(first.projects[0]?.tickets ?? [], key)).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#20`],
						});
						now += 11 * 60 * 1000;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const second = await settledOverview(base, async (url) => {
							return (await (
								await fetch(new URL("/api/overview", url))
							).json()) as typeof first & { polling?: true };
						});
						expect(listReads).toBeGreaterThan(1);
						expect(blockersOf(second.projects[0]?.tickets ?? [], key)).toEqual({
							state: "backlog",
							blockers: [],
						});
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(now),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket on a GitHub project leaves the pinned repo card", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const projectId = "PVT_widget";
		const board = "Widget board";
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: projectId,
								number: 3,
								title: board,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_shared",
											number: 23,
											title: "Sits on the repo and the project",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "Blocked by: #20",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_blocker",
											number: 20,
											title: "Open blocker",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(23, "Blocked by: #20"),
						html_url: `https://github.com/${githubRepo}/issues/23`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/23/comments`,
					},
					{
						...issue(20, "Open blocker."),
						html_url: `https://github.com/${githubRepo}/issues/20`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/20/comments`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 3 },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === board,
						);
						const repoCard = overview.projects.find(
							(item) => item.name === githubRepo,
						);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#23`),
						).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#20`],
						});
						expect(
							(repoCard?.tickets ?? []).some(
								(ticket) => ticket.key === `${githubRepo}#23`,
							),
						).toBe(false);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a project ticket keeps blockers from a later dependency page", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const projectId = "PVT_widget";
		const board = "Widget board";
		const requests: string[] = [];
		let failNext = false;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(`${url} ${body}`);
			if (failNext && body.includes("ProjectItems")) {
				failNext = false;
				return new Response("recorded failure", { status: 500 });
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: projectId,
								number: 3,
								title: board,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_paged",
											number: 30,
											title: "Waits on two dependency pages",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: {
												nodes: [
													{
														number: 31,
														state: "OPEN",
														repository: { nameWithOwner: githubRepo },
													},
												],
												pageInfo: {
													hasNextPage: true,
													endCursor: "cursor-31",
												},
											},
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_empty",
											number: 34,
											title: "An empty later dependency page",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: {
												nodes: [
													{
														number: 31,
														state: "OPEN",
														repository: { nameWithOwner: githubRepo },
													},
												],
												pageInfo: {
													hasNextPage: true,
													endCursor: "cursor-empty",
												},
											},
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("BlockedBy") &&
				body.includes("I_empty")
			) {
				return Response.json({
					data: {
						node: {
							blockedBy: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("BlockedBy")
			) {
				return Response.json({
					data: {
						node: {
							blockedBy: {
								nodes: [
									{
										number: 32,
										state: "OPEN",
										repository: { nameWithOwner: githubRepo },
									},
									{
										number: 33,
										state: "CLOSED",
										repository: { nameWithOwner: githubRepo },
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 3 }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = overview.projects.find(
							(item) => item.name === board,
						);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#30`).blockers,
						).toEqual([`${githubRepo}#31`, `${githubRepo}#32`]);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#34`).blockers,
						).toEqual([`${githubRepo}#31`]);
						expect(
							requests.some(
								(sent) =>
									sent.includes("BlockedBy") && sent.includes("cursor-31"),
							),
						).toBe(true);
						failNext = true;
						const failed = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(failed.status).toBe(204);
						const afterFailure = (await (
							await fetch(new URL("/api/overview", base))
						).json()) as typeof overview;
						const kept = afterFailure.projects.find(
							(item) => item.name === board,
						);
						expect(
							blockersOf(kept?.tickets ?? [], `${githubRepo}#30`).blockers,
						).toEqual([`${githubRepo}#31`, `${githubRepo}#32`]);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a project card keeps blockers from both nonempty bodies", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const projectId = "PVT_widget";
		const board = "Widget board";
		let refreshed = false;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: projectId,
								number: 3,
								title: board,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				const cleared = refreshed;
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_shared",
											number: 40,
											title: "Sits on the repo and the project",
											state: "OPEN",
											stateReason: null,
											updatedAt: cleared
												? "2026-08-18T13:00:00Z"
												: "2026-08-18T12:00:00Z",
											body: cleared ? "Blocked by: #42" : "Blocked by: #41",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_blank",
											number: 43,
											title: "A blank body borrows the repo line",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: cleared ? "Blocked by: #41" : "   ",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_41",
											number: 41,
											title: "Open blocker from the project body",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_42",
											number: 42,
											title: "Open blocker from the repo body",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_spaced",
											number: 44,
											title: "Repeated spaces in both bodies",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "Blocked by:   #41",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_blank_both",
											number: 45,
											title: "Blank on both rows",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "   ",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
									{
										content: {
											__typename: "Issue",
											id: "I_prose",
											number: 46,
											title: "A prose mention names no blocker",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "This ticket is blocked by the release, with no ref.",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				const cleared = refreshed;
				return page([
					{
						...issue(40, cleared ? "Blocked by: #41" : "Blocked by: #42"),
						updated_at: cleared
							? "2026-08-18T13:00:00Z"
							: "2026-08-18T12:00:00Z",
						html_url: `https://github.com/${githubRepo}/issues/40`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/40/comments`,
					},
					{
						...issue(43, "Blocked by: #42"),
						html_url: `https://github.com/${githubRepo}/issues/43`,
						comments_url: `https://api.github.com/${githubRepo}/issues/43/comments`,
					},
					{
						...issue(41, "Open."),
						html_url: `https://github.com/${githubRepo}/issues/41`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/41/comments`,
					},
					{
						...issue(42, "Open."),
						html_url: `https://github.com/${githubRepo}/issues/42`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/42/comments`,
					},
					{
						...issue(44, "Blocked by:   #42"),
						html_url: `https://github.com/${githubRepo}/issues/44`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/44/comments`,
					},
					{
						...issue(45, "   "),
						html_url: `https://github.com/${githubRepo}/issues/45`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/45/comments`,
					},
					{
						...issue(46, "Blocked by: none"),
						html_url: `https://github.com/${githubRepo}/issues/46`,
						comments_url: `https://api.github.com/repos/${githubRepo}/issues/46/comments`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 3 },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				const shared = `${githubRepo}#40`;
				const blank = `${githubRepo}#43`;
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const first = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = first.projects.find((item) => item.name === board);
						const repoCard = first.projects.find(
							(item) => item.name === githubRepo,
						);
						expect(blockersOf(project?.tickets ?? [], shared).state).toBe(
							"backlog",
						);
						expect(
							blockersOf(project?.tickets ?? [], shared).blockers.toSorted(),
						).toEqual([`${githubRepo}#41`, `${githubRepo}#42`]);
						expect(blockersOf(project?.tickets ?? [], blank)).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#42`],
						});
						expect(
							(repoCard?.tickets ?? []).some((ticket) => ticket.key === shared),
						).toBe(false);
						expect(
							(repoCard?.tickets ?? []).some((ticket) => ticket.key === blank),
						).toBe(false);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#44`).state,
						).toBe("backlog");
						expect(
							blockersOf(
								project?.tickets ?? [],
								`${githubRepo}#44`,
							).blockers.toSorted(),
						).toEqual([`${githubRepo}#41`, `${githubRepo}#42`]);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#45`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#46`),
						).toEqual({
							state: "backlog",
							blockers: [],
						});
						refreshed = true;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const second = (await (
							await fetch(new URL("/api/overview", base))
						).json()) as typeof first;
						const nextProject = second.projects.find(
							(item) => item.name === board,
						);
						const nextRepo = second.projects.find(
							(item) => item.name === githubRepo,
						);
						expect(blockersOf(nextProject?.tickets ?? [], shared).state).toBe(
							"backlog",
						);
						expect(
							blockersOf(
								nextProject?.tickets ?? [],
								shared,
							).blockers.toSorted(),
						).toEqual([`${githubRepo}#41`, `${githubRepo}#42`]);
						expect(
							(nextRepo?.tickets ?? []).some((ticket) => ticket.key === shared),
						).toBe(false);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a project card keeps a Blocks line from the repo body", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: "PVT_widget",
								number: 3,
								title: "Widget board",
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [20, 21].map((number) => ({
									content: {
										__typename: "Issue",
										id: `I_${number}`,
										number,
										title: `Ticket ${number}`,
										state: "OPEN",
										stateReason: null,
										updatedAt: "2026-08-18T12:00:00Z",
										body: number === 20 ? "Waiting on the release." : "",
										repository: { nameWithOwner: githubRepo },
										milestone: null,
										labels: { nodes: [] },
										parent: null,
										blockedBy: { nodes: [] },
									},
								})),
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([issue(20, "Blocks: #21"), issue(21, "Open.")]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 3 },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const body = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const project = body.projects.find(
							(item) => item.name === "Widget board",
						);
						expect(
							blockersOf(project?.tickets ?? [], `${githubRepo}#21`),
						).toEqual({
							state: "backlog",
							blockers: [`${githubRepo}#20`],
						});
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket on two GitHub projects stays on the first card", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				const number = body.includes('"number":4') ? 4 : 3;
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: `PVT_${number}`,
								number,
								title: `Board ${number}`,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectItems")
			) {
				return Response.json({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_20",
											number: 20,
											title: "Shared across two boards",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-18T12:00:00Z",
											body: "",
											repository: { nameWithOwner: githubRepo },
											milestone: null,
											labels: { nodes: [] },
											parent: null,
											blockedBy: { nodes: [] },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", owner: "acme", project: 3 },
					{ tracker: "github", owner: "acme", project: 4 },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const body = (await response.json()) as {
							projects: { name: string; tickets: { key: string }[] }[];
						};
						const cards = body.projects.filter((item) =>
							item.tickets.some((ticket) => ticket.key === `${githubRepo}#20`),
						);
						expect(cards.map((item) => item.name)).toEqual(["Board 3"]);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a repo ticket shows every blocker from a second REST page", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const first = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=1`;
		const second = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=2`;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(21, ""),
						issue_dependencies_summary: {
							blocked_by: 2,
							total_blocked_by: 2,
						},
					},
					issue(20, "Open blocker on the first page."),
					issue(19, "Open blocker on the second page."),
				]);
			}
			if (url === first) {
				return new Response(
					JSON.stringify([
						{
							number: 20,
							state: "open",
							repository_url: `https://api.github.com/repos/${githubRepo}`,
						},
					]),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${second}>; rel="next"`,
						},
					},
				);
			}
			if (url === second) {
				return page([
					{
						number: 19,
						state: "open",
						repository_url: `https://api.github.com/repos/${githubRepo}`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const fetching: Fetch = async (input, init) => {
			requests.push(urlOf(input));
			return recordedFetch(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const card = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						expect(
							blockersOf(card?.tickets ?? [], `${githubRepo}#21`).blockers,
						).toEqual([`${githubRepo}#20`, `${githubRepo}#19`]);
						expect(requests.filter((sent) => sent === first).length).toBe(1);
						expect(requests).toContain(second);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetching,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed second REST page leaves the repo card on its last good poll", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const first = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=1`;
		const second = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=2`;
		let polls = 0;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(21, ""),
						issue_dependencies_summary: {
							blocked_by: 2,
							total_blocked_by: 2,
						},
					},
					issue(20, "Open blocker on the first page."),
					issue(19, "Open blocker on the second page."),
				]);
			}
			if (url === first) {
				return new Response(
					JSON.stringify([
						{
							number: 20,
							state: "open",
							repository_url: `https://api.github.com/repos/${githubRepo}`,
						},
					]),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${second}>; rel="next"`,
						},
					},
				);
			}
			if (url === second) {
				polls += 1;
				if (polls > 1) {
					return new Response("unavailable", { status: 404 });
				}
				return page([
					{
						number: 19,
						state: "open",
						repository_url: `https://api.github.com/repos/${githubRepo}`,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				const key = `${githubRepo}#21`;
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const before = (await response.json()) as {
							projects: {
								name: string;
								error: string | null;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						expect(
							blockersOf(before.projects[0]?.tickets ?? [], key).blockers,
						).toEqual([`${githubRepo}#20`, `${githubRepo}#19`]);
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const after = await settledOverview(base, async (url) => {
							const response = await fetch(new URL("/api/overview", url));
							expect(response.status).toBe(200);
							return (await response.json()) as typeof before & {
								polling?: true;
							};
						});
						const card = after.projects.find(
							(project) => project.name === githubRepo,
						);
						expect(card?.error).toContain("GitHub read repo failed");
						expect(blockersOf(card?.tickets ?? [], key).blockers).toEqual([
							`${githubRepo}#20`,
							`${githubRepo}#19`,
						]);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closed blocker on a later REST page adds no blocker", async () => {
		const githubRepo = "AbysmalBiscuit/devkit";
		const first = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=1`;
		const second = `https://api.github.com/repos/${githubRepo}/issues/21/dependencies/blocked_by?per_page=100&page=2`;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			const list = `https://api.github.com/repos/${githubRepo}/issues?`;
			if (url.startsWith(list) && url.includes("state=all")) {
				return page([
					{
						...issue(21, ""),
						issue_dependencies_summary: {
							blocked_by: 1,
							total_blocked_by: 2,
						},
					},
					issue(20, "Open blocker on the first page."),
				]);
			}
			if (url === first) {
				return new Response(
					JSON.stringify([
						{
							number: 20,
							state: "open",
							repository_url: `https://api.github.com/repos/${githubRepo}`,
						},
					]),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${second}>; rel="next"`,
						},
					},
				);
			}
			if (url === second) {
				return new Response(
					JSON.stringify([
						{
							number: 19,
							state: "closed",
							repository_url: `https://api.github.com/repos/${githubRepo}`,
						},
					]),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${first}>; rel="prev"`,
						},
					},
				);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const fetching: Fetch = async (input, init) => {
			requests.push(urlOf(input));
			return recordedFetch(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: {
									key: string;
									state: string;
									blockers: string[];
								}[];
							}[];
						};
						const card = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						expect(blockersOf(card?.tickets ?? [], `${githubRepo}#21`)).toEqual(
							{
								state: "backlog",
								blockers: [`${githubRepo}#20`],
							},
						);
						expect(requests.filter((sent) => sent === first).length).toBe(1);
						expect(requests).toContain(second);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetching,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("one project lists six cross-project blockers and a neighbour lists none", async () => {
		const tall = "acme/tall";
		const short = "acme/short";
		const keys = [1, 2, 3, 4, 5, 6];
		const tallIssues = keys.map((number) => ({
			number,
			title: `Blocker ${number}`,
			state: "open",
			state_reason: null,
			updated_at: "2026-04-01T00:00:00Z",
			html_url: `https://github.com/${tall}/issues/${number}`,
			body: "",
		}));
		const shortIssues = [
			{
				number: 1,
				title: "Wait on six tickets",
				state: "open",
				state_reason: null,
				updated_at: "2026-04-01T00:00:00Z",
				html_url: `https://github.com/${short}/issues/1`,
				body: keys.map((number) => `Blocked by: ${tall}#${number}`).join("\n"),
			},
		];
		const recordedFetch: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith(`https://api.github.com/repos/${tall}/issues?`)) {
				return page(tallIssues);
			}
			if (url.startsWith(`https://api.github.com/repos/${short}/issues?`)) {
				return page(shortIssues);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments")
			) {
				return page([]);
			}
			return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: tall },
					{ tracker: "github", repo: short },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								crossProjectBlockers: {
									project: string;
									tracker: string;
									key: string;
									title: string;
								}[];
							}[];
						};
						const card = overview.projects.find(
							(project) => project.name === short,
						);
						const neighbour = overview.projects.find(
							(project) => project.name === tall,
						);
						expect(card?.crossProjectBlockers).toEqual(
							keys.map((number) => ({
								project: tall,
								tracker: "github",
								key: `${tall}#${number}`,
								title: `Blocker ${number}`,
							})),
						);
						expect(neighbour?.crossProjectBlockers).toEqual([]);
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
