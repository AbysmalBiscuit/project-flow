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
	test("returns the ask question, its numbered options and the PR status", async () => {
		const repo = "acme/widget";
		const question = "Which bot should review this?";
		const first = "Keep the current bot";
		const second = "Switch to the other bot";
		const head = "sha-ask";
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
						number: 7,
						title: "Pick a review bot",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 1,
						assignee: null,
						labels: [],
					},
					{
						number: 8,
						title: "Ship the widget",
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
				`https://api.github.com/repos/${repo}/issues/7/comments?per_page=100&page=1`
			) {
				return page([
					{
						id: 71,
						body: `${question}\n\n1. ${first}\n2. ${second}\n\n${ask("ask-7")}`,
						created_at: "2026-10-01T00:00:00Z",
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
						number: 40,
						title: "Ship the widget",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/40`,
						head: { ref: "40-ship", sha: head },
						body: "Closes #8",
						merged_at: null,
					},
				]);
			}
			if (url.includes(`/commits/${head}/check-runs`)) {
				return Response.json({
					check_runs: [
						{
							name: "ci",
							status: "completed",
							conclusion: "success",
						},
					],
				});
			}
			if (url.includes("/pulls/40/reviews")) {
				return page([
					{
						user: { login: "ada" },
						state: "APPROVED",
						commit_id: head,
					},
				]);
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				if (url.includes("/check-runs")) {
					return Response.json({ check_runs: [] });
				}
				if (url.includes("/commits/")) {
					return Response.json({
						commit: { committer: { date: "2026-10-01T00:00:00Z" } },
					});
				}
				return page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pmBot: { [repo]: false },
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
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.find((item) => item.key === `${repo}#7`)).toMatchObject({
				reason: "ask",
				question,
				options: [
					{ number: 1, label: first },
					{ number: 2, label: second },
				],
			});
			expect(items.find((item) => item.key === `${repo}#8`)).toMatchObject({
				reason: "awaitingMerge",
				pull: {
					number: 40,
					title: "Ship the widget",
					url: `https://github.com/${repo}/pull/40`,
					ci: "passing",
					review: "approved",
				},
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
