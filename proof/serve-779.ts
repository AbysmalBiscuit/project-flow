/**
 * Serves one GitHub repo and one Linear project, each with a ticket that has a
 * thread, so Settings and the side panel show both trackers.
 *
 * Usage: bun proof/serve-779.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { pull, repo } from "../test/support/github.ts";
import { linearFake } from "../test/support/linear.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const updatedAt = "2026-10-17T12:00:00.000Z";

function issue(number: number, title: string): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: updatedAt,
		html_url: `https://github.com/${repo}/issues/${number}`,
		body: "",
	};
}

const githubIssues = [
	issue(4, "Draw the project map"),
	issue(5, "Write the empty state copy"),
];

const githubComments = [
	{
		id: 9001,
		body: "The map draws each workstream as a lane.",
		user: { login: "ada" },
		created_at: updatedAt,
		html_url: `https://github.com/${repo}/issues/4#issuecomment-9001`,
	},
];

const github = recordedIssues(
	{ [repo]: githubIssues },
	{ [repo]: [pull(40, 4)] },
);

const linear = linearFake({
	project: {
		id: "project-widget",
		name: "Widget launch",
		slugId: "widget-launch-0d42ae5d46d0",
	},
	issues: [
		{
			id: "issue-wid-1",
			identifier: "WID-1",
			title: "Ship the launch list",
			description: "",
			state: { type: "started", name: "In Progress" },
			updatedAt,
			labels: { nodes: [] },
			parent: null,
			projectMilestone: null,
			comments: {
				nodes: [
					{
						id: "comment-1",
						body: "Which tickets make the first cut?",
						createdAt: updatedAt,
						user: { name: "Ada", displayName: "ada" },
					},
					{
						id: "comment-2",
						body: "The ones in Beta.",
						createdAt: updatedAt,
						parent: { id: "comment-1" },
						user: { name: "Lev", displayName: "lev" },
					},
				],
			},
		},
		{
			id: "issue-wid-2",
			identifier: "WID-2",
			title: "Write the release notes",
			description: "",
			state: { type: "unstarted", name: "Todo" },
			updatedAt,
			labels: { nodes: [] },
			parent: null,
			projectMilestone: null,
		},
	],
});

const fetch: Fetch = async (input, init) => {
	const url = urlOf(input);
	if (url.startsWith("https://api.linear.app/")) {
		return linear(input, init);
	}
	if (url === `https://api.github.com/repos/${repo}/issues/4`) {
		return Response.json(githubIssues[0]);
	}
	if (
		url.startsWith(`https://api.github.com/repos/${repo}/issues/4/comments`)
	) {
		return Response.json(githubComments);
	}
	const body = typeof init?.body === "string" ? init.body : "";
	if (body.includes("query LinkedPulls")) {
		return Response.json({
			data: {
				repository: {
					issue: { closedByPullRequestsReferences: { nodes: [] } },
				},
			},
		});
	}
	return github(input, init);
};

await serveRecorded({
	prefix: "project-flow-779-",
	port: process.argv[2]?.trim() || "4779",
	config: {
		pinned: [
			{ tracker: "github", repo },
			{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
	},
	fetch,
});
