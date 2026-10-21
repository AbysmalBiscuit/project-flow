import type { Fetch } from "../src/fetch.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const widget = "acme/widget";
const alpha = "acme/alpha";
const beta = "acme/beta";
const gamma = "acme/gamma";

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function issue(
	repo: string,
	number: number,
	title: string,
	body = "",
	milestone = "Alpha",
	assignee: string | null = null,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body,
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [{ name: "ready" }],
		assignee: assignee === null ? null : { login: assignee },
		milestone: { title: milestone },
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[widget]: [
		issue(widget, 90, "Zed the loose"),
		issue(widget, 3, "Chain b end", `Blocked by: ${widget}#2`),
		issue(widget, 2, "Chain b mid", `Blocked by: ${widget}#1`),
		issue(widget, 1, "Chain b start"),
		issue(widget, 13, "Chain a end", `Blocked by: ${widget}#12`, "Beta", "bea"),
		issue(widget, 12, "Chain a mid", `Blocked by: ${widget}#11`, "Beta", "bea"),
		issue(widget, 11, "Chain a start", "", "Beta", "ada"),
		issue(
			widget,
			20,
			"Fork tip",
			`Blocked by: ${widget}#21\nBlocked by: ${widget}#22`,
		),
		issue(widget, 22, "Fork right"),
		issue(widget, 21, "Fork left"),
	],
	[alpha]: [issue(alpha, 1, "Alpha start")],
	[beta]: [
		issue(beta, 2, "Beta waits", `Blocked by: ${alpha}#1`),
		issue(beta, 9, "Beta loose"),
	],
	[gamma]: [issue(gamma, 3, "Gamma waits", `Blocked by: ${beta}#2`)],
};

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
	const listed = repoReadFromLists(input, init, issues);
	if (listed !== null) {
		return listed;
	}
	for (const [repo, list] of Object.entries(issues)) {
		if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
			return page(list);
		}
	}
	if (
		emptyLists(url) ||
		url.includes("/dependencies/") ||
		url.includes("/labels?")
	) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4245";

await serveRecorded({
	prefix: "project-flow-graph-flows-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: alpha },
			{ tracker: "github", repo: beta },
			{ tracker: "github", repo: gamma },
		],
		checkoutRoots: [],
		pmBot: {
			[widget]: false,
			[alpha]: false,
			[beta]: false,
			[gamma]: false,
		},
		pollIntervalSeconds: 3600,
		theme: "light",
		overview: { view: "graph" },
		projectViews: {
			[widget]: {
				openView: "graph",
				groupBy: process.env.GRAPH_GROUP ?? "none",
				graphDirection: process.env.GRAPH_DIRECTION ?? "left-to-right",
			},
		},
	},
	fetch: recorded,
});
