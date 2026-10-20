import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const board = "acme/board";
const gate = "acme/gate";

function issue(
	number: number,
	title: string,
	repo: string,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T12:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

const boardIssues = [
	issue(12, "Ship the widget", board),
	issue(3, "Hold the launch", board),
];
const gateIssues = [issue(9, "Open the gate", gate)];

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${board}/issues?`)) {
		return Response.json(boardIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${gate}/issues?`)) {
		return Response.json(gateIssues);
	}
	if (url === `https://api.github.com/repos/${board}/issues/12`) {
		return Response.json({
			title: "Ship the widget",
			html_url: `https://github.com/${board}/issues/12`,
		});
	}
	if (url.includes("/issues/12/comments")) {
		return Response.json([
			{
				id: 1,
				body: "Ready for the jump",
				created_at: "2026-10-18T12:00:00Z",
				user: { login: "lev" },
			},
		]);
	}
	if (emptyLists(url)) {
		return Response.json([]);
	}
	return emptyLinear(url) ?? unrecorded(input);
};

await serveRecorded({
	prefix: "project-flow-jump-",
	port: process.env.PORT ?? "4188",
	config: {
		pinned: [
			{ tracker: "github", repo: board },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
	},
	fetch: recorded,
});
