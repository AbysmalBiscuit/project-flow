import type { Fetch } from "../src/fetch.ts";
import { recordedViewer, repoReadFromHandler, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const widget = "acme/widget";
const platform = "acme/platform";

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
		updated_at: "2026-08-18T12:00:00.000Z",
		body,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

const widgetIssues = [
	issue(widget, 8, "Open the gate", "Blocks: #2"),
	issue(widget, 2, "Draw the nodes"),
	issue(widget, 3, "Already shipped"),
];

const platformIssues = [
	issue(platform, 11, "Hold the platform", `Blocked by: ${widget}#8`),
];

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const read = await repoReadFromHandler(input, init, recorded);
	if (read !== null) {
		return read;
	}
	const url = urlOf(input);
	const linear = emptyLinear(url);
	if (linear !== null) {
		return linear;
	}
	if (url.includes(`/repos/${widget}/issues?`)) {
		return page(widgetIssues);
	}
	if (url.includes(`/repos/${platform}/issues?`)) {
		return page(platformIssues);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({ data: {} });
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4223";

await serveRecorded({
	prefix: "project-flow-blocks-",
	port,
	config: {
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: platform },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[widget]: { openView: "table", groupBy: "none" },
		},
	},
	fetch: recorded,
});
