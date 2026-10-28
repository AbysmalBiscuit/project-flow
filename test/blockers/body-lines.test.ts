import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
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
import {
	blockersOf,
	issue,
	linearIssue,
	linearProject,
	recordedFetch,
	repo,
} from "./_support.ts";

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
});
