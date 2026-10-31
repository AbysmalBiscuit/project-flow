import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { githubFetch, overview, page } from "../review-github-fake.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { pull, repo } from "../support/github.ts";
import { card, greptile, issue, mergedPull } from "./_support.ts";

describe("review cycle", () => {
	test("a merged history page skips the closing-refs query", async () => {
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
						const url = urlOf(input);
						const body = typeof init?.body === "string" ? init.body : "";
						requests.push(
							url === "https://api.github.com/graphql" ? body : url,
						);
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(95)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
							mergedPulls: [mergedPull()],
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
			await checks;
			const graphql = requests.filter((item) =>
				item.includes("query RepoRead"),
			);
			expect(graphql.length).toBeGreaterThan(0);
			expect(graphql[0]).toContain("closingIssuesReferences");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a merged PR that closes an open ticket moves it to Done", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			mergedPulls: [
				{
					...mergedPull(),
					body: "Closes #8",
				},
			],
		});
		expect(body).toEqual({
			projects: [
				{
					name: repo,
					tracker: "github",
					ref: { tracker: "github", repo },
					displayKey: repo,
					done: 1,
					dropped: 0,
					blocked: 0,
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					needsYou: 0,
					progress: 100,
					fetchedAt: "2026-10-18T12:00:00.000Z",
					error: null,
					tags: [],
					unlinkedPrs: [],
					tickets: [
						{
							key: `${repo}#8`,
							title: "Ticket 8",
							state: "done",
							blockers: [],
							lane: "Done",
							statusType: "done",
							enteredStateAt: "2026-10-01T00:00:00Z",
							updatedAt: "2026-10-01T00:00:00Z",
						},
					],
					crossProjectBlockers: [],
					statusTypes: {
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						done: 1,
						dropped: 0,
					},
				},
			],
			fetchedAt: "2026-10-18T12:00:00.000Z",
			error: null,
		});
	});

	test("a closed PR list with a next link fetches only page 1", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(95)],
			closedNext: `https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=2`,
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

	test("a second poll sends no review reads for a merged PR already seen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const reviewReads: string[] = [];
		const closedReads: string[] = [];
		const recorded = githubFetch({
			issues: [issue(8)],
			pulls: [pull(81)],
			checksBySha: {},
			commentsByPull: {
				1: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				],
			},
			reviewsByPull: {},
			reactionsByPull: {},
			mergedPulls: [mergedPull()],
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([issue(8)]);
			}
			if (url.includes("/pulls?state=closed")) {
				closedReads.push(url);
			}
			if (/\/(?:issues|pulls)\/1\/|\/commits\/[^/]+\/check-runs/.test(url)) {
				reviewReads.push(url);
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
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(reviewReads).toEqual([]);
			expect(closedReads).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
