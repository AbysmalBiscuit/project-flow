import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import outsideRelations from "../fixtures/outside-relations.json";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { githubIssueNode, repoReadIssues } from "../support/repo-read.ts";
import { blockersOf, issue, linearIssue, linearProject } from "./_support.ts";

describe("GET /api/overview blockers", () => {
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

	test("a pasted GitHub or Linear ticket URL resolves as a blocker", async () => {
		const githubRepo = "AbysmalBiscuit/workcell";
		const outside = "AbysmalBiscuit/factory";
		const linearKey = "SWE-12632";
		const inRepo = (
			name: string,
			item: Record<string, unknown>,
		): Record<string, unknown> => ({
			...item,
			html_url: `https://github.com/${name}/issues/${String(item.number)}`,
			comments_url: `https://api.github.com/repos/${name}/issues/${String(item.number)}/comments`,
		});
		const githubIssues = [
			issue(1, `Blocked by: https://github.com/${outside}/issues/220`),
			issue(2, `Blocked by: https://github.com/${outside}/pull/221`),
			issue(
				3,
				`Blocked by: https://linear.app/adaptyv-bio/issue/${linearKey.toLowerCase()}/keep-a-plugin-state`,
			),
			issue(4, `Blocked by: https://linear.app/adaptyv-bio/issue/${linearKey}`),
		].map((item) => inRepo(githubRepo, item));
		const outsideIssues = [issue(220, ""), issue(221, "")].map((item) =>
			inRepo(outside, item),
		);
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [linearIssue(linearKey, "", "started")],
			github: async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				if (url.includes("state=all")) {
					if (url.includes(`/repos/${githubRepo}/issues?`)) {
						return page(githubIssues);
					}
					if (url.includes(`/repos/${outside}/issues?`)) {
						return page(outsideIssues);
					}
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?") ||
					url.includes("/comments")
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
					{ tracker: "github", repo: outside },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: { key: string; state: string; blockers: string[] }[];
								crossProjectBlockers: { tracker: string; key: string }[];
							}[];
						};
						const github = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						const tickets = github?.tickets ?? [];
						expect(blockersOf(tickets, `${githubRepo}#1`).blockers).toEqual([
							`${outside}#220`,
						]);
						expect(blockersOf(tickets, `${githubRepo}#2`).blockers).toEqual([
							`${outside}#221`,
						]);
						expect(blockersOf(tickets, `${githubRepo}#3`).blockers).toEqual([
							linearKey,
						]);
						expect(blockersOf(tickets, `${githubRepo}#4`).blockers).toEqual([
							linearKey,
						]);
						expect(
							github?.crossProjectBlockers.map(({ tracker, key }) => ({
								tracker,
								key,
							})),
						).toEqual([
							{ tracker: "github", key: `${outside}#220` },
							{ tracker: "github", key: `${outside}#221` },
							{ tracker: "linear", key: linearKey },
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
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
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
});
