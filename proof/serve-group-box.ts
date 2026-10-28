import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
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
	milestone: string,
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
		comments: 0,
		labels: [],
		assignee: null,
		milestone: { title: milestone },
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
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([
			issue(7, "Ship the list", "Alpha", 1),
			issue(8, "Hold the launch", "Alpha"),
			issue(9, "Draft the page", "Beta"),
		]);
	}
	if (url.includes("/issues/7/dependencies/blocked_by")) {
		return page([
			{
				number: 8,
				title: "Hold the launch",
				state: "open",
				repository_url: `https://api.github.com/repos/${repo}`,
			},
		]);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4193";

await serveRecorded({
	prefix: "project-flow-group-box-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "graph", groupBy: "workstream" },
		},
	},
	fetch: recorded,
});
