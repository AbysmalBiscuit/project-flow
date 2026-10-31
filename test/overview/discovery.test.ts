import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { trackFound } from "../support/reads.ts";
import {
	emptyList,
	githubTicket,
	linearIssue,
	linearProject,
} from "./_support.ts";

describe("GET /api/overview", () => {
	test("a pull-only collaborator repo appears", async () => {
		const pullRepo = "acme/pull-only";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const pullOnly: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: pullRepo,
							owner: { login: "other" },
							permissions: { admin: false, push: false, pull: true },
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${pullRepo}/issues?`)) {
				return page([githubTicket(1, "open", null)], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
					fetch: pullOnly,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: pullRepo,
						tracker: "github",
						ref: { tracker: "github", repo: pullRepo },
						displayKey: pullRepo,
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: `${pullRepo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("finds a Linear project and a GitHub repo with no configuration entry", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const finding: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body === "" ? url : body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							owner: { login: "lev" },
							permissions: { admin: true, push: true, pull: true },
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`
			) {
				return page(
					[
						githubTicket(1, "open", null),
						githubTicket(2, "closed", "completed"),
					],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("viewer { id }") && !body.includes("projects(")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "linear-project-1",
											name: "Widget launch",
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				if (body.includes("projects(")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [
										{
											id: "linear-project-1",
											name: "Widget launch",
											slugId: linearProject,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [
									linearIssue("1", "backlog"),
									linearIssue("2", "completed"),
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: finding,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						ref: { tracker: "github", repo: repo },
						displayKey: repo,
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 50,
						tickets: [
							{
								key: `${repo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
							{
								key: `${repo}#2`,
								title: "Ticket 2",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
					},
					{
						name: "Widget launch",
						tracker: "linear",
						ref: { tracker: "linear", project: linearProject },
						displayKey: linearProject,
						done: 1,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 50,
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
							{
								key: "WID-2",
								title: "Linear ticket 2",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[1]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
			expect(requests.some((sent) => sent.includes("viewer { id }"))).toBe(
				true,
			);
			expect(requests.some((sent) => sent.includes("projects("))).toBe(true);
			expect(requests.some((sent) => sent.includes("/user/repos?"))).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GitHub project on the second organization page appears", async () => {
		const orgProjectId = "PVT_org_page_2";
		const requests: { variables?: Record<string, unknown> }[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const orgPage: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 1,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: "acme/org-board" },
											},
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("OrgProjects")
			) {
				const parsed = JSON.parse(body) as {
					variables?: Record<string, unknown>;
				};
				requests.push(parsed);
				const cursor = parsed.variables?.orgProjectAfter;
				const nodes =
					cursor === "org-projects-2"
						? [
								{
									id: orgProjectId,
									number: 9,
									owner: { login: "acme" },
									title: "Org board",
									closed: false,
									updatedAt: "2026-08-18T12:00:00Z",
								},
							]
						: [];
				return new Response(
					JSON.stringify({
						data: {
							organization: {
								projectsV2: {
									nodes,
									pageInfo: {
										hasNextPage: cursor === null,
										endCursor: cursor === null ? "org-projects-2" : null,
									},
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [{ login: "acme" }],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
					fetch: orgPage,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Org board",
						tracker: "github",
						ref: { tracker: "github", owner: "acme", project: 9 },
						displayKey: "acme/9",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: "acme/org-board#1",
								title: "",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
			expect(
				requests.some(
					(sent) => sent.variables?.orgProjectAfter === "org-projects-2",
				),
			).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear project where the viewer is a member appears", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const member: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			requests.push(body === "" ? url : body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null && url !== "https://api.linear.app/graphql") {
				return discovered;
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(") &&
				!body.includes("ProjectByPin")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { viewer?: string };
				};
				if (parsed.variables?.viewer !== "lev") {
					return new Response("missing viewer", { status: 400 });
				}
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "linear-member",
										name: "Member launch",
										slugId: "member-launch",
										updatedAt: "2026-08-18T12:00:00.000Z",
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql" && body.includes("viewer")) {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("ProjectByPin")
			) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "linear-member",
										name: "Member launch",
										slugId: "member-launch",
									},
								],
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [linearIssue("1", "backlog")],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
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
					fetch: member,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: "Member launch",
						tracker: "linear",
						ref: { tracker: "linear", project: "member-launch" },
						displayKey: "member-launch",
						done: 0,
						dropped: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
			const listed = requests.find((sent) => sent.includes("projects("));
			expect(listed).toContain("lead: { id: { eq: $viewer } }");
			expect(listed).toContain("members: { some: { id: { eq: $viewer } } }");
			expect(listed).not.toContain("members { nodes");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
