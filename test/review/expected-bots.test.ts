import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import {
	connection,
	githubFetch,
	overview,
	page,
} from "../review-github-fake.ts";
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
import { repoReadIssues } from "../support/repo-read.ts";
import { card, greptile, issue, mergedPull, older } from "./_support.ts";

describe("review cycle", () => {
	test("expected bots come from recorded merged PRs", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank expected-bot override is rejected and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [" "] },
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch({
						issues: [],
						pulls: [],
						checksBySha: {},
						commentsByPull: {},
						reviewsByPull: {},
						reactionsByPull: {},
					}),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("expectedBots");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a ready PR with no expected bots is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(93)],
			mergedPulls: [],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a draft PR skips review reads", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
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
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: async (input, init) => {
						requests.push(urlOf(input));
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(98, 8, head, true)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
						})(input, init);
					},
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
			expect(
				requests.some((url) =>
					/\/(?:issues|pulls)\/98\/|\/commits\/[^/]+\/check-runs/.test(url),
				),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear draft PR skips review reads", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
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
					fetch: linearFake({
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
											url: "https://github.com/acme/widget/pull/99",
											title: "draft",
											sourceType: "github",
										},
									],
								},
							},
						],
						github: async (input, init) => {
							const url = urlOf(input);
							requests.push(url);
							const discovered = recordedDiscovery(input, init);
							if (discovered !== null) {
								return discovered;
							}
							if (url === "https://api.github.com/user") {
								return page({ login: "lev" });
							}
							if (
								url === "https://api.github.com/graphql" &&
								(typeof init?.body === "string" ? init.body : "").includes(
									"query RepoRead",
								)
							) {
								requests.push(url);
								return page(
									repoReadIssues("acme", "widget", [], {
										pulls: [
											{
												number: 99,
												title: "Draft",
												url: "https://github.com/acme/widget/pull/99",
												isDraft: true,
												body: "",
												state: "OPEN",
												mergedAt: null,
												headRefName: "99-feat",
												headRefOid: head,
											},
										],
									}),
								);
							}
							if (url === "https://api.github.com/repos/acme/widget/pulls/99") {
								return page(pull(99, 8, head, true));
							}
							if (
								url.includes("/pulls?state=closed") ||
								url.includes("/labels?")
							) {
								return page([]);
							}
							return emptyProjectFields(input, init) ?? unrecorded(input);
						},
					}),
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
			expect(
				requests.some((url) =>
					/\/(?:issues|pulls)\/99\/|\/commits\/[^/]+\/check-runs/.test(url),
				),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a configuration override wins over detected expected bots", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(92)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [mergedPull()],
			config: JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [] },
			}),
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a Linear project does not wait on another repo's bot", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const other = "acme/other";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
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
		const fetchImpl: Fetch = linearFake({
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
								url: "https://github.com/acme/widget/pull/96",
								title: "ready",
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
					const parsed = JSON.parse(sent) as {
						variables?: { owner?: string; name?: string };
					};
					const owner = parsed.variables?.owner ?? "acme";
					const name = parsed.variables?.name ?? "widget";
					const pulls =
						`${owner}/${name}` === "acme/widget"
							? [
									{
										number: 96,
										title: "ready",
										url: "https://github.com/acme/widget/pull/96",
										isDraft: false,
										body: "Closes #8",
										state: "OPEN",
										mergedAt: null,
										headRefName: "96-feat",
										headRefOid: head,
										closingIssuesReferences: connection([]),
										reviews: connection([]),
										comments: connection([]),
										reactions: connection([]),
									},
								]
							: [];
					return page(repoReadIssues(owner, name, [], { pulls }));
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/96") {
					return page({
						...pull(96, 8),
						html_url: "https://github.com/acme/widget/pull/96",
					});
				}
				if (
					url ===
					`https://api.github.com/repos/${other}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([
						{
							number: 2,
							title: "merged elsewhere",
							state: "closed",
							draft: false,
							html_url: `https://github.com/${other}/pull/2`,
							head: { ref: "2-merged", sha: older },
							body: "",
							merged_at: "2026-10-01T00:00:00Z",
						},
					]);
				}
				if (
					url ===
					`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([]);
				}
				if (url.includes(`/repos/${other}/`) && url.includes("/comments?")) {
					return page([
						{ user: { login: greptile }, body: "<!-- greptile_summary -->" },
					]);
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (
					url.includes("/comments?") ||
					url.includes("/reviews?") ||
					url.includes("/reactions?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
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
			const body = (await checks) as {
				projects: { tickets: { state: string }[] }[];
			};
			expect(body.projects[0]?.tickets[0]?.state).toBe("awaitingMerge");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear expected-bot override wins", async () => {
		const linearProject = "widget-launch-0d42ae5d46d0";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
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
		const fetchImpl: Fetch = linearFake({
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
								url: "https://github.com/acme/widget/pull/96",
								title: "ready",
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
					return page(
						repoReadIssues("acme", "widget", [], {
							pulls: [
								{
									number: 96,
									title: "ready",
									url: "https://github.com/acme/widget/pull/96",
									isDraft: false,
									body: "Closes #8",
									state: "OPEN",
									mergedAt: null,
									headRefName: "96-feat",
									headRefOid: head,
									closingIssuesReferences: connection([]),
									reviews: connection([]),
									comments: connection([]),
									reactions: connection([]),
								},
							],
						}),
					);
				}
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				if (url === "https://api.github.com/user") {
					return page({ login: "lev" });
				}
				if (
					url ===
					`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
				) {
					return page([mergedPull()]);
				}
				if (url === "https://api.github.com/repos/acme/widget/pulls/96") {
					return page({
						...pull(96, 8),
						html_url: "https://github.com/acme/widget/pull/96",
					});
				}
				if (url.includes("/commits/") && url.includes("/check-runs")) {
					return page({ check_runs: [] });
				}
				if (url.includes("/issues/1/comments?")) {
					return page([
						{ user: { login: greptile }, body: "<!-- greptile_summary -->" },
					]);
				}
				if (
					url.includes("/comments?") ||
					url.includes("/reviews?") ||
					url.includes("/reactions?") ||
					url.includes("/labels?")
				) {
					return page([]);
				}
				return emptyProjectFields(input, init) ?? unrecorded(input);
			},
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
			expect(await checks).toEqual({
				projects: [
					{
						name: "Widget launch",
						tracker: "linear",
						ref: { tracker: "linear", project: linearProject },
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 1,
						needsYou: 1,
						progress: 0,
						fetchedAt: "2026-10-18T12:00:00.000Z",
						error: null,
						statusTypes: {
							backlog: 0,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 1,
							done: 0,
							dropped: 0,
						},
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-8",
								title: "Linear ticket 8",
								state: "awaitingMerge",
								blockers: [],
								lane: "Awaiting merge",
								statusType: "awaitingMerge",
								enteredStateAt: "2026-10-01T00:00:00.000Z",
								updatedAt: "2026-10-01T00:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
					},
				],
				fetchedAt: "2026-10-18T12:00:00.000Z",
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
