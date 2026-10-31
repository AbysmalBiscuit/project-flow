import { describe, expect, test } from "bun:test";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { withServer } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { readWhere } from "../support/reads.ts";
import { repoReadFromLists } from "../support/repo-read.ts";
import { gitlabEnv, gitlabFake, gitlabPin, gitlabRepo } from "./_support.ts";

function githubIssue(number: number, body: string, state: "open" | "closed") {
	return {
		number,
		title: `GitHub ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: "2026-10-01T00:00:00Z",
		html_url: `https://github.com/${gitlabRepo}/issues/${number}`,
		body,
		comments_url: `https://api.github.com/repos/${gitlabRepo}/issues/${number}/comments`,
	};
}

/** A GitHub repo with the path of the GitLab scratch repo. Its #4 is closed, and GitLab #4 is open. */
const githubIssues = [
	githubIssue(4, "", "closed"),
	githubIssue(10, "Blocked by: #4", "open"),
];

function githubFake(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const listed = repoReadFromLists(input, init, {
			[gitlabRepo]: githubIssues,
		});
		if (listed !== null) {
			return listed;
		}
		if (/\/(issues|pulls|branches|labels)\b/.test(url)) {
			return page([]);
		}
		return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
	};
}

describe("a GitHub repo and a GitLab repo with one path", () => {
	test("a bare #number names the ticket of the tracker of the ticket that writes it", async () => {
		const gitlab = gitlabFake({ descriptions: { 5: "Blocked by: #4" } });
		const github = githubFake();
		await withServer(
			(input, init) =>
				urlOf(input).startsWith("https://gitlab.com/")
					? gitlab(input, init)
					: github(input, init),
			3600,
			async (base) => {
				const overview = await readWhere<Overview>(
					new URL("/api/overview", base),
					(body) =>
						body.polling !== true &&
						body.projects.filter((project) => project.backlog > 0).length === 2,
				);
				const blocked = Object.fromEntries(
					overview.projects.map((project) => [
						project.tracker,
						project.blocked,
					]),
				);
				expect(blocked).toEqual({ github: 0, gitlab: 1 });
			},
			[{ tracker: "github", repo: gitlabRepo }, gitlabPin],
			{ GITHUB_TOKEN: "recorded-token", GITLAB_TOKEN: gitlabEnv.GITLAB_TOKEN },
		);
	});
});
