import { describe, expect, test } from "bun:test";

import type { Overview, SettingsProject } from "../../src/domain.ts";
import { missingGitlabToken } from "../../src/gitlab-forge.ts";
import scratchProject from "../fixtures/gitlab/project.json";
import { withServer } from "../support/app.ts";
import { readWhere, settledSettings, trackFound } from "../support/reads.ts";
import { gitlabEnv, gitlabFake, gitlabPin, gitlabRepo } from "./_support.ts";

describe("a GitLab repo that Lev is a member of", () => {
	test("shows in Settings as a found project, and tracking it reads its tickets", async () => {
		await withServer(
			gitlabFake(),
			3600,
			async (base) => {
				const settings = await settledSettings<{
					projects: SettingsProject[];
				}>(base);
				expect(settings.projects).toContainEqual(
					expect.objectContaining({
						key: gitlabRepo,
						tracker: "gitlab",
						source: "found",
						tracked: false,
						ref: gitlabPin,
					}),
				);
				await trackFound(base);
				const overview = await readWhere<Overview>(
					new URL("/api/overview", base),
					(body) =>
						body.projects.some(
							(project) => project.name === gitlabRepo && project.backlog > 0,
						),
				);
				expect(
					overview.projects.find((project) => project.name === gitlabRepo)
						?.error ?? null,
				).toBeNull();
			},
			[],
			{ GITLAB_TOKEN: gitlabEnv.GITLAB_TOKEN },
		);
	});
});

describe("the member projects of a GitLab token", () => {
	test("Settings lists a project from a later page", async () => {
		const other = {
			...scratchProject,
			path_with_namespace: "AbysmalBiscuit/other",
		};
		await withServer(
			gitlabFake({ memberPages: [[other], [scratchProject]] }),
			3600,
			async (base) => {
				const settings = await settledSettings<{
					projects: SettingsProject[];
				}>(base);
				expect(
					settings.projects
						.filter((project) => project.tracker === "gitlab")
						.map((project) => project.key)
						.sort(),
				).toEqual(["AbysmalBiscuit/other", gitlabRepo]);
			},
			[],
			{ GITLAB_TOKEN: gitlabEnv.GITLAB_TOKEN },
		);
	});
});

describe("a tracked GitLab repo with no GITLAB_TOKEN", () => {
	test("shows the missing token on the project and sends no GitLab request", async () => {
		const sent: string[] = [];
		await withServer(
			gitlabFake({ sent }),
			3600,
			async (base) => {
				const overview = await readWhere<Overview>(
					new URL("/api/overview", base),
					(body) => body.polling !== true,
				);
				expect(overview.projects[0]?.error).toBe(missingGitlabToken);
				expect(sent).toEqual([]);
			},
			[gitlabPin],
			{},
		);
	});
});
