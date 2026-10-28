import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
import { repoReadFromLists } from "../test/support/repo-read.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const alpha = "acme/alpha";
const beta = "acme/beta";
const gamma = "acme/gamma";
const widget = "acme/widget";
const gate = "acme/gate";

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
		assignee: null,
		milestone: null,
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[alpha]: [
		issue(alpha, 1, "Ship the list"),
		issue(alpha, 2, "Hold the launch"),
	],
	[beta]: [
		issue(beta, 11, "Wait on the list", `Blocked by: ${alpha}#1`),
		issue(beta, 12, "Wait on the launch", `Blocked by: ${alpha}#2`),
	],
	[gamma]: [issue(gamma, 21, "Draft the page", `Blocked by: ${beta}#11`)],
	[widget]: [
		issue(widget, 7, "Ship the list"),
		issue(widget, 8, "Hold the launch", `Blocked by: ${widget}#7`),
		issue(widget, 9, "Draft the page", `Blocked by: ${widget}#7`),
		issue(
			widget,
			10,
			"Open the gate",
			`Blocked by: ${widget}#8\nBlocked by: ${widget}#9\nBlocks: ${gate}#3`,
		),
	],
	[gate]: [issue(gate, 3, "Name the gate")],
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
		return (
			repoReadFromLists(input, init, issues) ?? Response.json({ data: {} })
		);
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4216";

await serveRecorded({
	prefix: "project-flow-graph-edges-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: alpha },
			{ tracker: "github", repo: beta },
			{ tracker: "github", repo: gamma },
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
		pmBot: {
			[alpha]: false,
			[beta]: false,
			[gamma]: false,
			[widget]: false,
			[gate]: false,
		},
		pollIntervalSeconds: 3600,
		theme: "light",
		overview: { view: "graph" },
		projectViews: {
			[widget]: { openView: "graph", groupBy: "none" },
		},
	},
	fetch: recorded,
});
