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
	fields: Record<string, unknown> = {},
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
		labels: [{ name: "ready" }],
		assignee: null,
		milestone: null,
		...fields,
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[widget]: [
		issue(widget, 2, "Ship the list", {
			body: `Blocked by: ${widget}#8`,
		}),
		issue(widget, 3, "Write the copy"),
		issue(widget, 5, "Draft the notes", {
			body: `Blocks: ${widget}#3\nBlocked by: ${gate}#4`,
		}),
		issue(widget, 8, "Open the gate", {
			state: "closed",
			state_reason: "completed",
		}),
	],
	[gate]: [
		issue(gate, 4, "Hold the platform", {
			state: "closed",
			state_reason: "completed",
		}),
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

const port = process.argv[2] ?? process.env.PORT ?? "4263";

await serveRecorded({
	prefix: "project-flow-graph-status-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
		pmBot: {
			[widget]: false,
			[gate]: false,
		},
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[widget]: { openView: "graph", groupBy: "none" },
		},
	},
	fetch: recorded,
});
