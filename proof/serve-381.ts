/**
 * Serves two recorded GitHub repos for the PR and Needs you chips on graph cards.
 * The project-flow ticket with a PR shows as a local card on its own graph and as an outside card on the factory graph.
 * Usage: bun proof/serve-381.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import recordedComments from "../test/fixtures/github-issue-comments-205.json";
import recordedIssues from "../test/fixtures/github-issues.json";
import recordedPulls from "../test/fixtures/github-open-pulls.json";
import outsideRelations from "../test/fixtures/outside-relations.json";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { serveRecorded, unrecorded } from "./recorded.ts";

const repo = "AbysmalBiscuit/project-flow";
const factory = "AbysmalBiscuit/factory";
const blocker = recordedIssues.find((issue) => issue.number === 205);
if (blocker === undefined) {
	throw new Error("recorded issue 205 is missing");
}

// The recordings hold no factory ticket blocked by a project-flow ticket.
// Factory issue 279 takes project-flow issue 205 as its one blocker.
const issuesByRepo = {
	[repo]: recordedIssues,
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

const fetch: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url === "https://api.github.com/graphql") {
		return (
			repoReadFromLists(input, init, issuesByRepo, { [repo]: recordedPulls }) ??
			unrecorded(input)
		);
	}
	const path = url.replace(`https://api.github.com/repos/${repo}`, "");
	if (path.startsWith("/issues/205/comments?")) {
		return Response.json(recordedComments);
	}
	if (path.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (url.startsWith("https://api.github.com/repos/")) {
		return Response.json([]);
	}
	return unrecorded(input);
};

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
