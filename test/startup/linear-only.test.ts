import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { rejectedToken } from "../../src/github.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { repoReadIssues } from "../support/repo-read.ts";

describe("startup", () => {
	test("a Linear-only configuration with a gh token shows a linked open PR in review", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { "acme/widget": ["grok"] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		const authorizations: string[] = [];
		const fetchImpl = linearFake({
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
				const url = urlOf(input);
				const sent = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					sent.includes("query RepoRead")
				) {
					return new Response(
						JSON.stringify(
							repoReadIssues("acme", "widget", [], {
								pulls: [
									{
										number: 83,
										title: "PR 83",
										url: "https://github.com/acme/widget/pull/83",
										isDraft: false,
										body: "",
										state: "OPEN",
										mergedAt: null,
										headRefName: "83-feat-review",
										headRefOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
										closingIssuesReferences: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reviews: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										comments: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reactions: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									},
								],
							}),
						),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const authorization = new Headers(init?.headers).get("authorization");
				if (authorization !== null) {
					authorizations.push(authorization);
				}
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/83") {
					return new Response(
						JSON.stringify({
							number: 83,
							title: "PR 83",
							state: "open",
							draft: false,
							html_url: "https://github.com/acme/widget/pull/83",
							head: {
								ref: "83-feat-review",
								sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							},
							body: "",
							merged_at: null,
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return new Response(JSON.stringify({ check_runs: [] }), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (url.includes("/commits/")) {
					return new Response(
						JSON.stringify({
							commit: { committer: { date: "2026-10-01T00:00:00Z" } },
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (url.includes("/pulls?state=closed")) {
					return new Response("[]", {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				if (
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/branches") ||
					url.includes("/labels?")
				) {
					return new Response("[]", {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
				return unrecorded(input);
			},
		});
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => "gh-printed-token",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			const body = await checks;
			expect(body.projects[0]).toMatchObject({
				name: "Widget launch",
				tracker: "linear",
				inReview: 1,
				tickets: [{ key: "WID-8", state: "inReview" }],
			});
			expect(authorizations).toContain("Bearer gh-printed-token");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear-only configuration with a blank gh token starts and leaves the linked PR off the ticket", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		const fetchImpl = linearFake({
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
			github: async () => {
				throw new Error("GitHub must not be called for a blank gh token");
			},
		});
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "   ", LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => "   ",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]).toMatchObject({
				tracker: "linear",
				error: null,
				inReview: 0,
				tickets: [{ key: "WID-8", state: "backlog" }],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear-only configuration with a rejected gh token exits 1", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: linearFake({
						github: async (input) => {
							const url = urlOf(input);
							if (url === "https://api.github.com/user") {
								return new Response(
									JSON.stringify({ message: "Bad credentials" }),
									{ status: 401 },
								);
							}
							throw new Error(`unexpected GitHub call: ${url}`);
						},
					}),
					readGhToken: async () => "rejected-gh-token",
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a Linear-only configuration starts without GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{
						tracker: "linear",
						project: "widget-launch-0d42ae5d46d0",
					},
				],
			}),
		);
		const fetchImpl = linearFake({
			github: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				throw new Error("GitHub must not be called without a token");
			},
		});
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});
});
