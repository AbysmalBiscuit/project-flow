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
		const list = `https://api.github.com/repos/${repo}/issues?`;
		if (url.startsWith(list) && url.includes("state=all")) {
			return page(recorded);
		}
		if (url.includes("/pulls?") || url.includes("/branches?")) {
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
		return new Response("not recorded", { status: 404 });
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
							state: "blocked",
							blockers: [key(404), key(405)],
						});
						expect(blockersOf(tickets, key(421))).toEqual({
							state: "blocked",
							blockers: [key(188)],
						});
						expect(blockersOf(tickets, key(422))).toEqual({
							state: "blocked",
							blockers: [key(188), key(220)],
						});
						expect(blockersOf(tickets, key(423))).toEqual({
							state: "blocked",
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
							state: "blocked",
							blockers: [key(426)],
						});
						expect(blockersOf(tickets, key(426)).blockers).toEqual([]);
						expect(blockersOf(tickets, key(427))).toEqual({
							state: "backlog",
							blockers: [],
						});
						expect(blockersOf(tickets, key(409))).toEqual({
							state: "blocked",
							blockers: [key(427)],
						});
						expect(blockersOf(tickets, key(428))).toEqual({
							state: "blocked",
							blockers: [key(410)],
						});
						expect(blockersOf(tickets, key(429))).toEqual({
							state: "blocked",
							blockers: [key(411)],
						});
						expect(blockersOf(tickets, key(430))).toEqual({
							state: "blocked",
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
							state: "blocked",
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
			github: async (input) => {
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
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([]);
				}
				if (url.includes("/comments")) {
					return page([]);
				}
				return new Response("not recorded", { status: 404 });
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
							state: "blocked",
							blockers: [linearKey],
						});
						expect(
							blockersOf(github?.tickets ?? [], `${githubRepo}#154`),
						).toEqual({
							state: "blocked",
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
		const recordedFetch = linearFake({
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
			github: async (input) => {
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
				const dependencies = `https://api.github.com/repos/${githubRepo}/issues/373/dependencies/blocked_by`;
				const closedNative = `https://api.github.com/repos/${githubRepo}/issues/374/dependencies/blocked_by`;
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
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([]);
				}
				return new Response("not recorded", { status: 404 });
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
							state: "blocked",
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
							state: "blocked",
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
							`https://api.github.com/repos/${githubRepo}/issues/373/dependencies/blocked_by`,
							`https://api.github.com/repos/${githubRepo}/issues/374/dependencies/blocked_by`,
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
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
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
							state: "blocked",
							blockers: [key(3)],
						});
						expect(blockersOf(tickets, key(4))).toEqual({
							state: "blocked",
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
			github: async (input) => {
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
				if (url.endsWith("/issues/90/dependencies/blocked_by")) {
					return page([
						{
							number: 7,
							state: "closed",
							repository_url: `https://api.github.com/repos/${unloaded}`,
						},
					]);
				}
				if (url.endsWith("/issues/93/dependencies/blocked_by")) {
					return page([
						{
							number: 8,
							state: "merged",
							repository_url: `https://api.github.com/repos/${unloaded}`,
						},
					]);
				}
				if (url.includes("/pulls?") || url.includes("/branches?")) {
					return page([]);
				}
				if (url.includes("/comments")) {
					return page([]);
				}
				return new Response("not recorded", { status: 404 });
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
							state: "blocked",
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
				`https://api.github.com/repos/${githubRepo}/issues/80/dependencies/blocked_by`
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
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return page([]);
			}
			if (url.includes("/comments")) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
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
							state: "blocked",
							blockers: [`${unloaded}#9`],
						});
						expect(project?.blocked).toBe(1);
						expect(project?.crossProjectBlockers).toEqual([
							{
								project: unloaded,
								tracker: "github",
								key: `${unloaded}#9`,
								title: `${unloaded}#9`,
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
									project: { slugId: "unpinned-project" },
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
							state: "blocked",
							blockers: ["SWE-3"],
						});
						expect(project?.blocked).toBe(1);
						expect(project?.crossProjectBlockers).toEqual([
							{
								project: "unpinned-project",
								tracker: "linear",
								key: "SWE-3",
								title: "SWE-3",
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
			if (url.endsWith("/issues/4/dependencies/blocked_by")) {
				return page([
					{
						number: 8,
						state: "closed",
						html_url: `https://github.com/${githubRepo}/issues/8`,
						repository_url: `https://api.github.com/repos/${githubRepo}`,
					},
				]);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return page([]);
			}
			return new Response("not recorded", { status: 404 });
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
							state: "blocked",
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
						expect(requests.some((sent) => sent.includes("/issues/6"))).toBe(
							false,
						);
						expect(blockersOf(tickets, key(10))).toEqual({
							state: "blocked",
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
							requests.some((url) => url.endsWith("/dependencies/blocked_by")),
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
});
