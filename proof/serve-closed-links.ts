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
		issue(widget, 7, "Ship the list", {
			state: "closed",
			state_reason: "completed",
		}),
		issue(widget, 8, "Hold the launch", {
			body: `Blocked by: ${widget}#7\nBlocked by: ${gate}#4`,
		}),
		issue(widget, 9, "Draft the page", { body: `Blocked by: ${widget}#8` }),
	],
	[gate]: [
		issue(gate, 3, "Name the gate", { body: `Blocked by: ${widget}#7` }),
		issue(gate, 4, "Close the gate", {
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

const port = process.argv[2] ?? process.env.PORT ?? "4225";

await serveRecorded({
	prefix: "project-flow-closed-links-",
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
