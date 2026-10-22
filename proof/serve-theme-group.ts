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
	options: { parent?: number; milestone?: string } = {},
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
		milestone:
			options.milestone === undefined ? null : { title: options.milestone },
		...(options.parent === undefined
			? {}
			: {
					parent_issue_url: `https://api.github.com/repos/${repo}/issues/${options.parent}`,
				}),
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[repo]: [
		issue(20, "feat: redesign the board"),
		issue(21, "feat(board): draw the lanes", { parent: 20 }),
		issue(22, "feat(board): draw the cards", { parent: 20 }),
		issue(23, "feat(board): sort the rows", {
			parent: 20,
			milestone: "October",
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
	const listed = repoReadFromLists(input, init, issues);
	if (listed !== null) {
		return listed;
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page(issues[repo] ?? []);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4342";

await serveRecorded({
	prefix: "project-flow-theme-group-",
	port,
	config: {
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[repo]: { openView: "graph", groupBy: "theme" },
		},
	},
	fetch: recorded,
});
