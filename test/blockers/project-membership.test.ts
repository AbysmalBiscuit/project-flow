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
import { blockersOf, issue } from "./_support.ts";

describe("GET /api/overview blockers", () => {
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
