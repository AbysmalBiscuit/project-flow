import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";
import { ask } from "./_support.ts";

describe("needs you", () => {
	test("lists an open ask addressed to Lev on a PR", async () => {
		const repo = "acme/widget";
		const question = "This waits on Lev for the signing key.";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					const read = await repoReadFromHandler(input, init, recorded);
					if (read !== null) {
						return read;
					}
				}
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
			) {
				return page([
					{
						number: 49,
						title: "Count PR asks",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/49`,
						head: { ref: "49-feat-pr-ask", sha: "sha-49" },
						body: "A fix with no ticket.",
						merged_at: null,
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/49/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `${question}\n\n${ask("pr-49")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/check-runs") ||
				url.includes("/commits/sha-49")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/sha-49")
						? Response.json({
								commit: { committer: { date: "2026-10-01T00:00:00Z" } },
							})
						: page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{
			items: NeedsYouItem[];
			needsYou: number;
		}>((resolve, reject) => {
			startChecks = (base) => {
				Promise.all([
					fetch(new URL("/api/needs-you", base)),
					fetch(new URL("/api/overview", base)),
				])
					.then(async ([needs, overview]) => {
						expect(needs.status).toBe(200);
						expect(overview.status).toBe(200);
						const projects = (
							(await overview.json()) as {
								projects: { needsYou: number }[];
							}
						).projects;
						resolve({
							items: (await needs.json()) as NeedsYouItem[],
							needsYou: projects[0]?.needsYou ?? 0,
						});
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const { items, needsYou } = await checks;
			expect(needsYou).toBe(1);
			expect(items.map((item) => item.key)).toEqual([`${repo}#49`]);
			expect(items[0]).toMatchObject({
				headline: question,
				reason: "ask",
				answered: false,
				tags: ["matched by name"],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("lists an unlinked PR that is awaiting merge", async () => {
		const repo = "acme/widget";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					const read = await repoReadFromHandler(input, init, recorded);
					if (read !== null) {
						return read;
					}
				}
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
			) {
				return page([
					{
						number: 90,
						title: "A fix with no ticket",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/90`,
						head: { ref: "pr-90", sha: "sha-90" },
						body: "A fix with no ticket.",
						merged_at: null,
					},
					{
						number: 91,
						title: "Draft fix",
						state: "open",
						draft: true,
						html_url: `https://github.com/${repo}/pull/91`,
						head: { ref: "pr-91", sha: "sha-91" },
						body: "   ",
						merged_at: null,
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/")
						? Response.json({
								commit: { committer: { date: "2026-10-01T00:00:00Z" } },
							})
						: page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{
			items: NeedsYouItem[];
			needsYou: number;
		}>((resolve, reject) => {
			startChecks = (base) => {
				Promise.all([
					fetch(new URL("/api/needs-you", base)),
					fetch(new URL("/api/overview", base)),
				])
					.then(async ([needs, overview]) => {
						expect(needs.status).toBe(200);
						expect(overview.status).toBe(200);
						const projects = (
							(await overview.json()) as {
								projects: { needsYou: number }[];
							}
						).projects;
						resolve({
							items: (await needs.json()) as NeedsYouItem[],
							needsYou: projects[0]?.needsYou ?? 0,
						});
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const { items, needsYou } = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#90`]);
			expect(needsYou).toBe(1);
			expect(items[0]).toMatchObject({
				headline: "A fix with no ticket",
				reason: "awaitingMerge",
				answered: false,
				tags: [],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("omits a senior-only PR ask and keeps an answered PR ask", async () => {
		const repo = "acme/widget";
		const question = "Which bot should review this?";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					const read = await repoReadFromHandler(input, init, recorded);
					if (read !== null) {
						return read;
					}
				}
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
			) {
				return page([
					{
						number: 92,
						title: "Senior ask",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/92`,
						head: { ref: "pr-92", sha: "sha-92" },
						body: "A fix with no ticket.",
						merged_at: null,
					},
					{
						number: 93,
						title: "Answered ask",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/93`,
						head: { ref: "pr-93", sha: "sha-93" },
						body: "A fix with no ticket.",
						merged_at: null,
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/92/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `Senior, ${question}\n\n${ask("pr-92")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/93/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `Senior, this waits on Lev for the signing key.\n\n${ask("pr-93")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
					{
						body: "Reply: noted.",
						created_at: "2026-10-01T01:00:00Z",
						user: { login: "lev" },
						reactions: { total_count: 1 },
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/")
						? Response.json({
								commit: { committer: { date: "2026-10-01T00:00:00Z" } },
							})
						: page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: ["grok"] },
				pmBot: { [repo]: true },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#93`]);
			expect(items.find((item) => item.key === `${repo}#93`)).toMatchObject({
				reason: "ask",
				answered: true,
				acknowledged: true,
				tags: ["matched by name"],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("folds a linked PR ask into its ticket item", async () => {
		const repo = "acme/widget";
		const headline = "This waits on Lev for the signing key.";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					const read = await repoReadFromHandler(input, init, recorded);
					if (read !== null) {
						return read;
					}
				}
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 8,
						title: "Ship the signing key",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 0,
						assignee: null,
						labels: [],
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
			) {
				return page([
					{
						number: 49,
						title: "Count PR asks",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/49`,
						head: { ref: "49-feat-pr-ask", sha: "sha-49" },
						body: "Closes #8",
						merged_at: null,
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/49/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: `${headline}\n\n${ask("pr-49")}`,
						created_at: "2026-10-01T00:00:00Z",
						user: { login: "agent" },
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/")
						? Response.json({
								commit: { committer: { date: "2026-10-01T00:00:00Z" } },
							})
						: page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.map((item) => item.key)).toEqual([`${repo}#8`]);
			expect(items[0]).toMatchObject({
				tracker: "github",
				headline,
				reason: "ask",
				answered: false,
				tags: ["matched by name"],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
