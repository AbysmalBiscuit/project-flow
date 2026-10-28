import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
import { emptyLinear, serveRecorded, unrecorded } from "./recorded.ts";

const repo = "acme/widget";
const question = "Which bot should review this?";
const first = "Keep the current bot";
const second = "Switch to the other bot";
const ask = "<!-- workcell:ask why-paths -->";

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function issue(
	number: number,
	title: string,
	blockedBy = 0,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: number === 7 ? 1 : 0,
		labels: [],
		assignee: null,
		issue_dependencies_summary: {
			blocked_by: blockedBy,
			total_blocked_by: blockedBy,
		},
	};
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
			return Response.json({
				data: {
					viewer: {
						login: "lev",
						projectsV2: {
							nodes: [],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
						organizations: {
							nodes: [],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		return Response.json({
			data: {
				repository: {
					pullRequest: { closingIssuesReferences: { nodes: [] } },
					issue: { closedByPullRequestsReferences: { nodes: [] } },
				},
			},
		});
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([
			issue(7, "Pick a review bot", 1),
			issue(8, "Ship the widget"),
		]);
	}
	if (url === `https://api.github.com/repos/${repo}/issues/7`) {
		return Response.json({
			title: "Pick a review bot",
			html_url: `https://github.com/${repo}/issues/7`,
		});
	}
	if (url === `https://api.github.com/repos/${repo}/issues/8`) {
		return Response.json({
			title: "Ship the widget",
			html_url: `https://github.com/${repo}/issues/8`,
		});
	}
	if (url.includes(`/repos/${repo}/issues/7/comments`)) {
		return page([
			{
				id: 71,
				body: `${question}\n\n1. ${first}\n2. ${second}\n\n${ask}`,
				created_at: "2026-10-01T00:00:00Z",
				user: { login: "agent" },
				html_url: `https://github.com/${repo}/issues/7#issuecomment-71`,
			},
		]);
	}
	if (url.includes("/issues/7/dependencies/blocked_by")) {
		return page([
			{
				number: 8,
				title: "Ship the widget",
				state: "open",
				repository_url: `https://api.github.com/repos/${repo}`,
			},
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/labels?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/dependencies/")
	) {
		return page([]);
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4191";

await serveRecorded({
	prefix: "project-flow-why-paths-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
	},
	fetch: recorded,
});
