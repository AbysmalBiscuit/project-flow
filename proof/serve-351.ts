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
const platform = "acme/platform";

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		html_url: `https://github.com/${widget}/issues/${number}`,
		comments: 0,
		labels: [{ name: "ready" }],
		assignee: { login: "ada" },
		milestone: { title: "October" },
		...fields,
	};
}

function under(parent: number): { parent_issue_url: string } {
	return {
		parent_issue_url: `https://api.github.com/repos/${widget}/issues/${parent}`,
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[widget]: [
		issue(1, "Ship the map"),
		issue(2, "Draw the nodes", under(1)),
		issue(3, "Draw the edges", under(1)),
		issue(4, "Colour the nodes", under(2)),
		issue(5, "Wire the platform hook", {
			parent: {
				number: 9,
				title: "Platform gate",
				state: "OPEN",
				url: `https://github.com/${platform}/issues/9`,
				repository: { nameWithOwner: platform },
			},
		}),
		issue(6, "Write the notes"),
	],
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
	if (
		emptyLists(url) ||
		url.includes("/dependencies/") ||
		url.includes("/labels?")
	) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? "4351";

await serveRecorded({
	prefix: "project-flow-351-",
	port,
	config: {
		pinned: [{ tracker: "github", repo: widget }],
		checkoutRoots: [],
		pmBot: { [widget]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[widget]: {
				openView: "graph",
				groupBy: process.argv[3] ?? "none",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch: recorded,
});
