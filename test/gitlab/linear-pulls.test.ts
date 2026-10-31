import { describe, expect, test } from "bun:test";

import type { Overview, ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { rejectedGitlabToken } from "../../src/gitlab-forge.ts";
import { run } from "../../src/main.ts";
import recordedJobs from "../fixtures/gitlab/jobs.json";
import { tempConfig, testIo, withServer } from "../support/app.ts";
import { settledRead } from "../support/reads.ts";
import {
	gitlabEnv,
	type GitlabFake,
	gitlabFake,
	gitlabRepo,
	linearName,
	linearProject,
	linearTicket,
	linearWithGitlab,
} from "./_support.ts";

const linearPin = { tracker: "linear" as const, project: linearProject };

async function reportOf(base: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(linearName)}?view=all`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectReport;
}

/** Starts the app on a Linear project whose ticket WID-1 links GitLab MR !12, and runs the checks. */
function withLinkedMergeRequest(
	gitlab: GitlabFake,
	checks: (base: string) => Promise<void>,
	env: Record<string, string> = gitlabEnv,
): Promise<void> {
	return withServer(
		linearWithGitlab([linearTicket(1, [12])], gitlabFake(gitlab)),
		3600,
		checks,
		[linearPin],
		env,
	);
}

describe("a Linear project that links GitLab PRs", () => {
	test("a Linear ticket with a GitLab attachment shows its PR and moves to In review", async () => {
		const sent: string[] = [];
		await withLinkedMergeRequest(
			{ open: { 12: { merge_when_pipeline_succeeds: true } }, sent },
			async (base) => {
				const report = await reportOf(base);
				expect(
					report.tickets.find((ticket) => ticket.key === "WID-1"),
				).toMatchObject({
					state: "inReview",
					pull: `${gitlabRepo}#12`,
					pullUrl: `https://gitlab.com/${gitlabRepo}/-/merge_requests/12`,
					pullForge: "GitLab",
				});
				expect(sent).toContain(
					"https://gitlab.com/api/v4/projects/acme%2Fwidget/merge_requests?state=opened&per_page=100&page=1",
				);
			},
		);
	});

	test("a PR with passing pipelines and approvals and auto-merge off moves its ticket to Awaiting merge", async () => {
		await withLinkedMergeRequest({}, async (base) => {
			const report = await reportOf(base);
			expect(
				report.tickets.find((ticket) => ticket.key === "WID-1"),
			).toMatchObject({ state: "awaitingMerge", pull: `${gitlabRepo}#12` });
		});
	});

	test("the expected bots of the GitLab repo come from its recent merged PRs", async () => {
		const reviewed = {
			...recordedJobs,
			"1500009": [
				...recordedJobs["1500009"],
				{
					id: 8090002,
					name: "greptile-review",
					stage: "review",
					status: "success",
					allow_failure: true,
					web_url: "https://gitlab.com/acme/widget/-/jobs/8090002",
				},
			],
		};
		await withLinkedMergeRequest({ jobs: reviewed }, async (base) => {
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
			const report = await reportOf(base);
			expect(
				report.tickets.find((ticket) => ticket.key === "WID-1"),
			).toMatchObject({ state: "inReview" });
		});
	});

	test("an open GitLab PR with no ticket shows as an unlinked PR", async () => {
		await withLinkedMergeRequest({}, async (base) => {
			const report = await reportOf(base);
			expect(
				report.tickets.find((ticket) => ticket.key === `${gitlabRepo}#13`),
			).toMatchObject({
				title: "Bump the lint rules",
				unlinkedPr: true,
				workstream: "Unlinked PRs",
				pullUrl: `https://gitlab.com/${gitlabRepo}/-/merge_requests/13`,
			});
		});
	});
});

describe("the GitLab token", () => {
	test("a missing GITLAB_TOKEN marks the project that links a GitLab PR", async () => {
		const sent: string[] = [];
		await withLinkedMergeRequest(
			{ sent },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(overview.projects).toMatchObject([
					{ tracker: "linear", error: expect.stringContaining("GITLAB_TOKEN") },
				]);
				expect(sent).toEqual([]);
			},
			{ LINEAR_API_KEY: gitlabEnv.LINEAR_API_KEY },
		);
	});

	test("a rejected GITLAB_TOKEN stops the start", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [linearPin] }),
		);
		const gitlab: Fetch = gitlabFake({ userStatus: 401 });
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: gitlabEnv,
					fetch: linearWithGitlab([], gitlab),
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
