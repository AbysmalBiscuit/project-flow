import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { page } from "../review-github-fake.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	head,
	pull,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { grok, progress } from "./_support.ts";

describe("review cycle", () => {
	test("a workcell progress comment on a Linear ticket keeps its PR in review", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const recorded = linearFake({
			requests,
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				requests.push(sent);
				return page({
					data: {
						issue: {
							comments: {
								nodes: [
									{
										body: progress(
											"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
										),
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: "WID-8", state: "inReview" }],
					},
				],
			});
			expect(requests.some((body) => body.includes("IssueComments"))).toBe(
				true,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report after a Linear progress comment sets its PR to awaiting merge", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentCursors: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				const after =
					(JSON.parse(sent) as { variables?: { after?: string | null } })
						.variables?.after ?? null;
				commentCursors.push(`comments:${after ?? "start"}`);
				const nodes =
					after === "page-2"
						? [
								{
									body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
								},
							]
						: [{ body: "noted" }];
				return page({
					data: {
						issue: {
							comments: {
								nodes,
								pageInfo: {
									hasNextPage: after !== "page-2",
									endCursor: after === "page-2" ? null : "page-2",
								},
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			const body = await checks;
			expect(commentCursors).toEqual(["comments:page-2"]);
			expect(body).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
			expect(body).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a later Linear comment page with a time stays after the progress comment", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
								createdAt: "2026-10-02T00:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentQueries: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				commentQueries.push(sent);
				const after =
					(JSON.parse(sent) as { variables?: { after?: string | null } })
						.variables?.after ?? null;
				const nodes =
					after === "page-2"
						? [
								{
									body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
									createdAt: "2026-10-03T00:00:00.000Z",
								},
							]
						: [
								{
									body: "noted",
									createdAt: "2026-10-01T00:00:00.000Z",
								},
							];
				return page({
					data: {
						issue: {
							comments: {
								nodes,
								pageInfo: {
									hasNextPage: after !== "page-2",
									endCursor: after === "page-2" ? null : "page-2",
								},
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(commentQueries.some((body) => body.includes("createdAt"))).toBe(
				true,
			);
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank Linear comment does not invent a workcell run", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [{ body: "   " }, { body: null }],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
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
					fetch: recorded,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed Linear comment page does not invent a workcell run", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [{ body: "noted" }],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				return new Response("recorded failure", { status: 500 });
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("Linear list comments failed");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a newest-first Linear comment page still sets awaiting merge", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: ["grok"] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = linearFake({
			project: {
				id: "project-1",
				name: "Widget launch",
				slugId: linearProject,
			},
			issues: [
				{
					identifier: "WID-8",
					title: "Linear ticket 8",
					updatedAt: "2026-10-01T00:00:00.000Z",
					state: { type: "unstarted" },
					comments: {
						nodes: [
							{
								body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
								createdAt: "2026-10-03T00:00:00.000Z",
								user: { name: "Ada", displayName: "Ada Lovelace" },
							},
							{
								body: progress(
									"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
								),
								createdAt: "2026-10-02T00:00:00.000Z",
								user: { name: "Ada", displayName: "Ada Lovelace" },
							},
						],
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
					attachments: {
						nodes: [
							{
								url: "https://github.com/acme/widget/pull/83",
								title: "PR 83",
								sourceType: "github",
							},
						],
					},
				},
			],
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return page(pull(83));
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({
						check_runs: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
							},
						],
					});
				}
				if (url.includes("/commits/")) {
					return page({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				if (url.includes("/pulls?state=closed")) {
					return page([]);
				}
				if (url.includes("/pulls/83/reviews")) {
					return page([
						{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
					]);
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
		});
		const commentQueries: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (sent.includes("IssueComments")) {
				commentQueries.push(sent);
				return page({
					data: {
						issue: {
							comments: {
								nodes: [
									{
										body: "noted later",
										createdAt: "2026-10-04T00:00:00.000Z",
										user: { name: "Ada", displayName: "Ada Lovelace" },
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(commentQueries.every((body) => body.includes("displayName"))).toBe(
				true,
			);
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: "WID-8", state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
