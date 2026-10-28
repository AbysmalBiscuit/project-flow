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
	test("two GitHub projects with the same title both appear", async () => {
		const sameTitle = "acme/widget";
		const firstId = "PVT_same_1";
		const secondId = "PVT_same_2";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const sameName: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: sameTitle,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-08-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${sameTitle}/issues?`)) {
				return page([githubTicket(1, "open", null)], null);
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
											id: firstId,
											number: 1,
											owner: { login: "lev" },
											title: sameTitle,
											closed: false,
											updatedAt: "2026-08-18T12:00:00Z",
										},
										{
											id: secondId,
											number: 2,
											owner: { login: "lev" },
											title: sameTitle,
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
				const number = variables.variables?.id === firstId ? 11 : 12;
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
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("projects(")) {
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
					fetch: sameName,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const overview = (await checks) as {
				projects: { name: string; tracker: string; backlog: number }[];
			};
			const titled = overview.projects.filter(
				(project) => project.name === sameTitle,
			);
			expect(titled).toHaveLength(3);
			expect(titled.filter((project) => project.tracker === "github")).toEqual(
				titled,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket on a repo and its GitHub project counts once under the project", async () => {
		const projectId = "PVT_widget";
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const shared = githubTicket(9, "open", null);
		const repoOnly = githubTicket(4, "open", null);
		const both: Fetch = async (input, init) => {
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
							permissions: { push: true },
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`
			) {
				return page([shared, repoOnly], null);
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
										{
											content: {
												__typename: "Issue",
												number: 8,
												state: "CLOSED",
												stateReason: "COMPLETED",
												repository: { nameWithOwner: repo },
											},
										},
										{
											content: {
												__typename: "PullRequest",
												number: 3,
												state: "OPEN",
												repository: { nameWithOwner: repo },
											},
										},
										{ content: null },
									],
									pageInfo: { hasNextPage: false, endCursor: null },
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
									nodes: [
										{
											id: projectId,
											number: 3,
											owner: { login: "acme" },
											title: "Widget board",
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
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("projects(")) {
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
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
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
					fetch: both,
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
						name: "Widget board",
						tracker: "github",
						ref: { tracker: "github", owner: "acme", project: 3 },
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
								key: "acme/widget#9",
								title: "",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "",
							},
							{
								key: "acme/widget#8",
								title: "",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
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
							done: 1,
							dropped: 0,
						},
					},
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
								key: `${repo}#4`,
								title: "Ticket 4",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
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
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
			expect(requests.some((sent) => sent.includes(`node(id: $id)`))).toBe(
				true,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
