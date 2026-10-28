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
	repo,
	unrecorded,
} from "../support/github.ts";
import { trackFound } from "../support/reads.ts";
import { emptyList, githubTicket } from "./_support.ts";

describe("GET /api/overview", () => {
	test("a tracked GitHub project shows and an untracked GitHub project never shows", async () => {
		const pinnedId = "PVT_pinned";
		const hiddenId = "PVT_hidden";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", owner: "acme", project: 7 }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const board: Fetch = async (input, init) => {
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
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: hiddenId,
											number: 8,
											owner: { login: "acme" },
											title: "Hidden board",
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
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
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				const variables = JSON.parse(body) as { variables?: { id?: string } };
				const id = variables.variables?.id;
				const number = id === pinnedId ? 1 : 2;
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: "acme/other" },
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
				body.includes("ProjectByNumber")
			) {
				const variables = JSON.parse(body) as {
					variables?: { owner?: string; number?: number };
				};
				const number = variables.variables?.number;
				const id = number === 7 ? pinnedId : hiddenId;
				const title = number === 7 ? "Pinned board" : "Hidden board";
				return new Response(
					JSON.stringify({
						data: {
							repositoryOwner: {
								projectV2: {
									id,
									number,
									title,
									closed: false,
									updatedAt: "2026-01-01T12:00:00Z",
								},
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
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
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
						name: "Pinned board",
						tracker: "github",
						ref: { tracker: "github", owner: "acme", project: 7 },
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
								key: "acme/other#1",
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
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an untracked GitHub project releases its tickets to the repo", async () => {
		const hiddenId = "PVT_hidden_claim";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const hiddenBoard: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repo}/issues?`)) {
				return page([githubTicket(9, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: hiddenId,
											number: 8,
											owner: { login: "acme" },
											title: "Hidden board",
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
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
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
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
					fetch: hiddenBoard,
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
						name: repo,
						tracker: "github",
						ref: { tracker: "github", repo: repo },
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
								key: `${repo}#9`,
								title: "Ticket 9",
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

	test("a closed GitHub project releases its tickets to the repo", async () => {
		const closedId = "PVT_closed";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const closedBoard: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repo,
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repo}/issues?`)) {
				return page([githubTicket(9, "open", null)], null);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ViewerProjects")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [
										{
											id: closedId,
											number: 5,
											owner: { login: "acme" },
											title: "Closed board",
											closed: true,
											updatedAt: "2026-08-18T12:00:00Z",
										},
									],
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
												number: 9,
												state: "OPEN",
												stateReason: null,
												repository: { nameWithOwner: repo },
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
					fetch: closedBoard,
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
						name: repo,
						tracker: "github",
						ref: { tracker: "github", repo: repo },
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
								key: `${repo}#9`,
								title: "Ticket 9",
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

	test("a tracked quiet Linear project shows and an untracked active project does not", async () => {
		const pinnedLinear = "quiet-linear";
		const hiddenRepo = "acme/hidden-live";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "linear", project: pinnedLinear }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const edge: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: hiddenRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200 },
				);
			}
			if (url.includes("/issues?")) {
				return page(
					[
						{
							number: 1,
							title: "Open",
							state: "open",
							state_reason: null,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
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
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("ProjectIssues")
			) {
				return new Response(
					JSON.stringify({
						data: {
							issues: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
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
										id: "quiet-linear-id",
										name: "Quiet linear",
										slugId: pinnedLinear,
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
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
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
					fetch: edge,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
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
						name: "Quiet linear",
						tracker: "linear",
						ref: { tracker: "linear", project: pinnedLinear },
						done: 0,
						dropped: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						blocked: 0,
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						tickets: [],
						unlinkedPrs: [],
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 0,
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
});
