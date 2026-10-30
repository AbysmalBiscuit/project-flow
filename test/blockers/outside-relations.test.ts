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
import { blockersOf, issue, linearIssue, linearProject } from "./_support.ts";

describe("GET /api/overview blockers", () => {
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
