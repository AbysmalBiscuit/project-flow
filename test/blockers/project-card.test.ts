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
});
