import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const repo = "acme/widget";

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function issue(
	number: number,
	title: string,
	parent = 0,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: null,
		milestone: null,
		...(parent === 0
			? {}
			: {
					parent_issue_url: `https://api.github.com/repos/${repo}/issues/${parent}`,
				}),
		issue_dependencies_summary: {
			blocked_by: 0,
			total_blocked_by: 0,
		},
	};
}

const parents = [
	issue(1, "Ship the list"),
	issue(2, "Name the rows", 1),
	issue(3, "Count the rows", 1),
	issue(4, "Sort the rows", 1),
	issue(5, "Ship the page"),
	issue(6, "Draw the header", 5),
	issue(7, "Draw the footer", 5),
];

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
		return page(parents);
	}
	const thread =
		/^https:\/\/api\.github\.com\/repos\/acme\/widget\/issues\/(\d+)$/.exec(
			url,
		);
	if (thread?.[1] !== undefined) {
		const number = Number(thread[1]);
		const known = parents.find((item) => item.number === number);
		if (known !== undefined) {
			return Response.json(known);
		}
	}
	if (
		emptyLists(url) ||
		url.includes("/dependencies/") ||
		url.includes("/comments")
	) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({
			data: {
				repository: {
					issue: { closedByPullRequestsReferences: { nodes: [] } },
				},
			},
		});
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4197";

await serveRecorded({
	prefix: "project-flow-edge-free-groups-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: {
				openView: "graph",
				groupBy: "workstream",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch: recorded,
});
