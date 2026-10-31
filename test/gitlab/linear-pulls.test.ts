import { describe, expect, test } from "bun:test";

import { rejectedGitlabToken } from "../../src/gitlab-forge.ts";
import { run } from "../../src/main.ts";
import merged from "../fixtures/gitlab/merge-request-merged.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
import { tempConfig, testIo, withServer } from "../support/app.ts";
import { settledRead } from "../support/reads.ts";
import {
	gitlabEnv,
	gitlabFake,
	gitlabPullUrl,
	gitlabRepo,
	linearPin,
	linearWithGitlab,
	linkedTicket,
	ticketOf,
	withLinkedPull,
} from "./_support.ts";

describe("a Linear project that links GitLab PRs", () => {
	test("a Linear ticket with a GitLab attachment shows its PR and moves to In review", async () => {
		const sent: string[] = [];
		await withLinkedPull(
			{ open: { 1: { merge_when_pipeline_succeeds: true } }, sent },
			async (base) => {
				expect(await ticketOf(base, "WID-1")).toMatchObject({
					state: "inReview",
					pull: `${gitlabRepo}#1`,
					pullUrl: gitlabPullUrl(1),
					pullForge: "GitLab",
				});
				expect(sent).toContain(
					`https://gitlab.com/api/v4/projects/${encodeURIComponent(gitlabRepo)}/merge_requests?state=opened&per_page=100&page=1`,
				);
			},
		);
	});

	test("a PR with passing pipelines and approvals and auto-merge off moves its ticket to Awaiting merge", async () => {
		await withLinkedPull({}, async (base) => {
			expect(await ticketOf(base, "WID-1")).toMatchObject({
				state: "awaitingMerge",
				pull: `${gitlabRepo}#1`,
			});
		});
	});

	test("the expected bots of the GitLab repo come from its recent merged PRs", async () => {
		const pipeline = { ...pipelines[1][0], id: 77, sha: merged.sha };
		await withLinkedPull(
			{
				merged: [merged],
				pipelines: { [merged.iid]: [pipeline] },
				jobs: {
					[pipeline.id]: [
						{ name: "greptile-review", status: "success", allow_failure: true },
					],
				},
			},
			async (base) => {
				const settings = (await (
					await settledRead(new URL("/api/settings", base))
				).json()) as {
					projects: {
						tracker: string;
						repos: string[];
						repoBots: Record<string, string[]>;
					}[];
				};
				const hosted = `gitlab.com/${gitlabRepo}`;
				expect(
					settings.projects.find((row) => row.tracker === "linear"),
				).toMatchObject({
					repos: [hosted],
					repoBots: { [hosted]: ["greptile"] },
				});
				expect(await ticketOf(base, "WID-1")).toMatchObject({
					state: "inReview",
				});
			},
		);
	});

	test("an open GitLab PR with no ticket shows as an unlinked PR", async () => {
		await withLinkedPull({}, async (base) => {
			expect(await ticketOf(base, `${gitlabRepo}#3`)).toMatchObject({
				title: "chore(app): add a change with no ticket",
				unlinkedPr: true,
				workstream: "Unlinked PRs",
				pullUrl: gitlabPullUrl(3),
			});
		});
	});
});

describe("the GitLab token", () => {
	test("a missing GITLAB_TOKEN marks the project that links a GitLab PR", async () => {
		const sent: string[] = [];
		await withServer(
			linearWithGitlab([linkedTicket], gitlabFake({ sent })),
			3600,
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as { projects: { error: string | null }[] };
				expect(overview.projects[0]?.error).toContain("GITLAB_TOKEN");
				expect(sent).toEqual([]);
			},
			[linearPin],
			{ LINEAR_API_KEY: gitlabEnv.LINEAR_API_KEY },
		);
	});

	test("a rejected GITLAB_TOKEN stops the start", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [linearPin] }),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: gitlabEnv,
					fetch: linearWithGitlab([], gitlabFake({ userStatus: 401 })),
					readGhToken: async () => null,
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedGitlabToken);
		} finally {
			await cleanup();
		}
	});
});
