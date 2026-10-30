import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { emptyProjectFields, page, unrecorded } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { blockersOf, issue, linearIssue, linearProject } from "./_support.ts";

describe("GET /api/overview blockers", () => {
	test("a pasted GitHub or Linear ticket URL resolves as a blocker", async () => {
		const githubRepo = "AbysmalBiscuit/workcell";
		const outside = "AbysmalBiscuit/factory";
		const linearKey = "SWE-12632";
		const inRepo = (
			name: string,
			item: Record<string, unknown>,
		): Record<string, unknown> => ({
			...item,
			html_url: `https://github.com/${name}/issues/${String(item.number)}`,
			comments_url: `https://api.github.com/repos/${name}/issues/${String(item.number)}/comments`,
		});
		const githubIssues = [
			issue(1, `Blocked by: https://github.com/${outside}/issues/220`),
			issue(2, `Blocked by: https://github.com/${outside}/pull/221`),
			issue(
				3,
				`Blocked by: https://linear.app/adaptyv-bio/issue/${linearKey.toLowerCase()}/keep-a-plugin-state`,
			),
			issue(4, `Blocked by: https://linear.app/adaptyv-bio/issue/${linearKey}`),
		].map((item) => inRepo(githubRepo, item));
		const outsideIssues = [issue(220, ""), issue(221, "")].map((item) =>
			inRepo(outside, item),
		);
		const recordedFetch = linearFake({
			project: {
				id: "project-widget",
				name: linearProject,
				slugId: linearProject,
			},
			issues: [linearIssue(linearKey, "", "started")],
			github: async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				if (url.includes("state=all")) {
					if (url.includes(`/repos/${githubRepo}/issues?`)) {
						return page(githubIssues);
					}
					if (url.includes(`/repos/${outside}/issues?`)) {
						return page(outsideIssues);
					}
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?") ||
					url.includes("/comments")
				) {
					return page([]);
				}
				return (
					emptyProjectFields(input, init ?? undefined) ?? unrecorded(input)
				);
			},
		});
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: outside },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const overview = (await response.json()) as {
							projects: {
								name: string;
								tickets: { key: string; state: string; blockers: string[] }[];
								crossProjectBlockers: { tracker: string; key: string }[];
							}[];
						};
						const github = overview.projects.find(
							(project) => project.name === githubRepo,
						);
						const tickets = github?.tickets ?? [];
						expect(blockersOf(tickets, `${githubRepo}#1`).blockers).toEqual([
							`${outside}#220`,
						]);
						expect(blockersOf(tickets, `${githubRepo}#2`).blockers).toEqual([
							`${outside}#221`,
						]);
						expect(blockersOf(tickets, `${githubRepo}#3`).blockers).toEqual([
							linearKey,
						]);
						expect(blockersOf(tickets, `${githubRepo}#4`).blockers).toEqual([
							linearKey,
						]);
						expect(
							github?.crossProjectBlockers.map(({ tracker, key }) => ({
								tracker,
								key,
							})),
						).toEqual([
							{ tracker: "github", key: `${outside}#220` },
							{ tracker: "github", key: `${outside}#221` },
							{ tracker: "linear", key: linearKey },
						]);
						resolve();
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
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
