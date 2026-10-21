import type { Fetch } from "../src/fetch.ts";
import {
	recordedDiscovery,
	repoReadFromHandler,
	urlOf,
} from "../test/support.ts";
import { serveRecorded, unrecorded } from "./recorded.ts";

const tall = "acme/tall";
const short = "acme/short";
const empty = "acme/empty";
const port = process.argv[2] ?? "4794";
const blockerCount = 6;

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
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-08-01T12:00:00.000Z",
		body,
		labels: [{ name: "ready" }],
		assignee: null,
	};
}

const tallIssues = Array.from({ length: blockerCount }, (_, index) =>
	issue(tall, index + 1, `Blocker ${index + 1}`),
);

const shortIssues = [
	issue(
		short,
		1,
		"Wait on six tickets",
		Array.from(
			{ length: blockerCount },
			(_, index) => `Blocked by: ${tall}#${index + 1}`,
		).join("\n"),
	),
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
	if (url.startsWith(`https://api.github.com/repos/${tall}/issues?`)) {
		return Response.json(tallIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${short}/issues?`)) {
		return Response.json(shortIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${empty}/issues?`)) {
		return Response.json([]);
	}
	if (url.includes("/labels?")) {
		return Response.json([]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/dependencies/")
	) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("query RepoRead")) {
			const read = await repoReadFromHandler(input, init, recorded);
			if (read !== null) {
				return read;
			}
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: "acme/tall",
					autoMergeAllowed: false,
					issue: { closedByPullRequestsReferences: { nodes: [] } },
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
		});
	}
	if (url === "https://api.linear.app/graphql") {
		return Response.json({
			data: {
				viewer: { id: "lev" },
				projects: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	return unrecorded(input);
};

await serveRecorded({
	prefix: "project-flow-174-",
	port,
	config: {
		theme: "light",
		pinned: [
			{ tracker: "github", repo: tall },
			{ tracker: "github", repo: short },
			{ tracker: "github", repo: empty },
		],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
	},
	fetch: recorded,
});
