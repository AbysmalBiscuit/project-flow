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
import { settledOverview } from "../support/reads.ts";
import { blockersOf, issue } from "./_support.ts";

describe("GET /api/overview blockers", () => {
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
});
