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
	test("a ticket comment that quotes the PR ask ID clears the folded row", async () => {
		const repo = "acme/widget";
		const headline = "This waits on Lev for the signing key.";
		const head = "sha-49";
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
						comments: 1,
						assignee: null,
						labels: [],
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/8/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: "The ask pr-49 is answered.",
						created_at: "2026-10-02T00:00:00Z",
						user: { login: "lev" },
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
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
			) {
				return page([
					{
						number: 1,
						title: "merged",
						state: "closed",
						draft: false,
						html_url: `https://github.com/${repo}/pull/1`,
						head: { ref: "1-merged", sha: "sha-1" },
						body: "",
						merged_at: "2026-09-01T00:00:00Z",
					},
				]);
			}
			if (url.includes("/commits/sha-1/check-runs")) {
				return Response.json({
					check_runs: [
						{
							name: "Grok code review",
							status: "completed",
							conclusion: "success",
						},
					],
				});
			}
			if (url.includes(`/commits/${head}/check-runs`)) {
				return Response.json({
					check_runs: [
						{
							name: "Grok code review",
							status: "in_progress",
							conclusion: null,
						},
					],
				});
			}
			if (url.includes("/pulls/1/reviews")) {
				return page([
					{
						user: { login: "grok-code-review[bot]" },
						commit_id: "sha-1",
					},
				]);
			}
			if (
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/commits/")
			) {
				return url.includes("/commits/")
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
			expect(items).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket progress comment that records human picks clears the folded row", async () => {
		const repo = "acme/widget";
		const headline = "This waits on Lev for the signing key.";
		const head = "sha-49";
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
						comments: 1,
						assignee: null,
						labels: [],
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/8/comments?per_page=100&page=1`
			) {
				return page([
					{
						body: "**Workcell progress**\n- ask-pr-49: 2026-10-02T00:00:00Z human picks: 1",
						created_at: "2026-10-02T00:00:00Z",
						user: { login: "agent" },
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
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&page=1`
			) {
				return page([
					{
						number: 1,
						title: "merged",
						state: "closed",
						draft: false,
						html_url: `https://github.com/${repo}/pull/1`,
						head: { ref: "1-merged", sha: "sha-1" },
						body: "",
						merged_at: "2026-09-01T00:00:00Z",
					},
				]);
			}
			if (url.includes("/commits/sha-1/check-runs")) {
				return Response.json({
					check_runs: [
						{
							name: "Grok code review",
							status: "completed",
							conclusion: "success",
						},
					],
				});
			}
			if (url.includes(`/commits/${head}/check-runs`)) {
				return Response.json({
					check_runs: [
						{
							name: "Grok code review",
							status: "in_progress",
							conclusion: null,
						},
					],
				});
			}
			if (url.includes("/pulls/1/reviews")) {
				return page([
					{
						user: { login: "grok-code-review[bot]" },
						commit_id: "sha-1",
					},
				]);
			}
			if (
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments?") ||
				url.includes("/reviews?") ||
				url.includes("/reactions?") ||
				url.includes("/commits/")
			) {
				return url.includes("/commits/")
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
			expect(items).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a PR linked only to a closed ticket stays an unlinked PR ask", async () => {
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
						state: "closed",
						state_reason: "completed",
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
			expect(items.map((item) => item.key)).toEqual([`${repo}#49`]);
			expect(items[0]).toMatchObject({
				tracker: "github",
				headline,
				reason: "ask",
				answered: false,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
