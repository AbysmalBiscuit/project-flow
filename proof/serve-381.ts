/**
 * Serves two recorded GitHub repos for the PR and Needs you chips on graph cards.
 * The project-flow ticket with a PR shows as a local card on its own graph and as an outside card on the factory graph.
 * Usage: bun proof/serve-381.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import recordedComments from "../test/fixtures/github-issue-comments-205.json";
import githubIssues from "../test/fixtures/github-issues.json";
import recordedPulls from "../test/fixtures/github-open-pulls.json";
import outsideRelations from "../test/fixtures/outside-relations.json";
import { urlOf } from "../test/support.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const repo = "AbysmalBiscuit/project-flow";
const factory = "AbysmalBiscuit/factory";
const blocker = githubIssues.find((issue) => issue.number === 205);
if (blocker === undefined) {
	throw new Error("recorded issue 205 is missing");
}

// The recordings hold no factory ticket blocked by a project-flow ticket.
// Factory issue 279 takes project-flow issue 205 as its one blocker.
const issuesByRepo = {
	[repo]: githubIssues,
	[factory]: [
		{
			...outsideRelations.githubFactory279,
			dependencyRows: [
				{
					number: blocker.number,
					title: blocker.title,
					state: "open",
					html_url: blocker.html_url,
					repository_url: `https://api.github.com/repos/${repo}`,
				},
			],
		},
	],
};

const recorded = recordedIssues(issuesByRepo, { [repo]: recordedPulls });

const fetch: Fetch = async (input, init) =>
	urlOf(input).startsWith(
		`https://api.github.com/repos/${repo}/issues/205/comments?`,
	)
		? Response.json(recordedComments)
		: recorded(input, init);

await serveRecorded({
	prefix: "project-flow-381-",
	port: process.argv[2]?.trim() || "4381",
	config: {
		pinned: [
			{ tracker: "github", repo },
			{ tracker: "github", repo: factory },
		],
		checkoutRoots: [],
		pmBot: { [repo]: false, [factory]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "graph" },
			[factory]: { openView: "graph" },
		},
	},
	fetch,
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
