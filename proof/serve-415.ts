/**
 * Serves recorded GitHub and Linear tickets, with and without a linked PR, for the panel PR button.
 * Usage: bun proof/serve-415.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import recordedComments from "../test/fixtures/github-issue-comments-205.json";
import recordedIssues from "../test/fixtures/github-issues.json";
import recordedPulls from "../test/fixtures/github-open-pulls.json";
import recordedTeam from "../test/fixtures/linear-team-states.json";
import outsideRelations from "../test/fixtures/outside-relations.json";
import {
	linearFake,
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { serveRecorded, unrecorded } from "./recorded.ts";

const repo = "AbysmalBiscuit/project-flow";
const issues = [...recordedIssues, outsideRelations.githubIssue80];
const recordedPull = recordedPulls.find((pull) => pull.number === 206);
if (recordedPull === undefined) {
	throw new Error("recorded PR 206 is missing");
}

const launch = {
	id: "project-launch",
	name: "Fleet rollout",
	slugId: "fleet-rollout-257b06861460",
	teams: { nodes: [{ id: "team-swe", key: "SWE", name: "SWE" }] },
};

// The recordings hold no Linear ticket with a PR attachment. SWE-13029 gets
// the recorded PR 206 as its one attachment.
const linearTickets = [
	{
		...outsideRelations.linearSwe13029,
		id: "swe-13029",
		attachments: {
			nodes: [
				{
					url: recordedPull.html_url,
					title: recordedPull.title,
					sourceType: "github",
				},
			],
		},
	},
	{
		...outsideRelations.linearOps3838,
		id: "ops-3838",
		attachments: { nodes: [] },
	},
];

const linear = linearFake({
	project: launch,
	states: recordedTeam.data.team.states.nodes,
	issues: linearTickets,
});

const fetch: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.linear.app/graphql") {
		return linear(input, init);
	}
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url === "https://api.github.com/graphql") {
		return (
			repoReadFromLists(
				input,
				init,
				{ [repo]: issues },
				{ [repo]: recordedPulls },
			) ?? unrecorded(input)
		);
	}
	const path = url.replace(`https://api.github.com/repos/${repo}`, "");
	if (path === "/pulls/206") {
		return Response.json(recordedPull);
	}
	const issue = issues.find((item) => path === `/issues/${item.number}`);
	if (issue !== undefined) {
		return Response.json(issue);
	}
	if (path.startsWith("/issues/205/comments?")) {
		return Response.json(recordedComments);
	}
	if (path.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (path !== url) {
		return Response.json([]);
	}
	return unrecorded(input);
};

await serveRecorded({
	prefix: "project-flow-415-",
	port: process.argv[2]?.trim() || "4415",
	config: {
		pinned: [
			{ tracker: "github", repo },
			{ tracker: "linear", project: launch.slugId },
		],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "board" },
			[launch.name]: { openView: "board" },
		},
	},
	fetch,
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
