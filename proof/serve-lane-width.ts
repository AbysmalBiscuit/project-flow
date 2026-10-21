import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const repo = "acme/widget";

const labels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const end = { hasNextPage: false, endCursor: null };

function recordedIssue(
	number: number,
	title: string,
	issueLabels: string[],
	state: "OPEN" | "CLOSED" = "OPEN",
) {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-10-18T12:00:00Z",
		createdAt: "2026-10-01T00:00:00Z",
		closedAt: state === "CLOSED" ? "2026-10-18T12:00:00Z" : null,
		body: "",
		comments: { nodes: [], pageInfo: end },
		labels: {
			nodes: issueLabels.map((name) => ({ name, color: "d0d7de" })),
			pageInfo: end,
		},
		assignees: { nodes: [] },
		milestone: null,
		parent: null,
		blockedBy: { nodes: [], pageInfo: end },
		blocking: { nodes: [], pageInfo: end },
	};
}

const issues = [
	recordedIssue(7, "Ship the list of factory tickets", ["ready"]),
	recordedIssue(8, "Hold the launch window open", ["factory: running"]),
	recordedIssue(9, "Read the review comments twice", ["factory: in-review"]),
	recordedIssue(
		10,
		"Merge the board after the last review round",
		[],
		"CLOSED",
	),
];

function recordedRepo(): Response {
	return Response.json({
		data: {
			repository: {
				nameWithOwner: repo,
				autoMergeAllowed: false,
				refs: { nodes: [], pageInfo: end },
				labels: {
					nodes: labels,
					pageInfo: end,
				},
				issues: { nodes: issues, pageInfo: end },
				openPullRequests: { nodes: [], pageInfo: end },
				mergedPullRequests: { nodes: [], pageInfo: end },
			},
		},
	});
}

function restIssue(item: ReturnType<typeof recordedIssue>) {
	return {
		number: item.number,
		title: item.title,
		state: item.state === "CLOSED" ? "closed" : "open",
		state_reason: item.stateReason === "COMPLETED" ? "completed" : null,
		updated_at: item.updatedAt,
		closed_at: item.closedAt,
		body: "",
		html_url: `https://github.com/${repo}/issues/${String(item.number)}`,
		comments: 0,
		labels: item.labels.nodes,
		assignee: null,
		milestone: null,
	};
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page(issues.map(restIssue));
	}
	if (url.includes("/labels?")) {
		return page(labels);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("RepoRead")) {
			return recordedRepo();
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
				},
			},
		});
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4195";

await serveRecorded({
	prefix: "project-flow-lane-width-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "dark",
		projectViews: {
			[repo]: { openView: "board", groupBy: "none" },
		},
	},
	fetch: recorded,
});
