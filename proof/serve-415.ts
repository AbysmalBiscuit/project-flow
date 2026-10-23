/**
 * Serves a GitHub and a Linear project, each with one ticket that has a linked PR and one without.
 * Usage: bun proof/serve-415.ts [PORT]
 */
import type { Fetch } from "../src/fetch.ts";
import {
	linearFake,
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { stateOf, teamStates } from "./linear-states.ts";
import { emptyLists, serveRecorded, unrecorded } from "./recorded.ts";

const widget = "acme/widget";
const launch = "acme/launch";

function issue(number: number, title: string, body = "") {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-21T12:00:00Z",
		body,
		html_url: `https://github.com/${widget}/issues/${number}`,
		comments: 0,
		labels: [],
		assignee: null,
		milestone: null,
	};
}

function pull(repo: string, number: number, title: string, body: string) {
	return {
		number,
		title,
		state: "open",
		draft: false,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `pr-${number}`, sha: `sha-${number}` },
		body,
	};
}

// Invented tickets, because a proof run must not read a live tracker.
const issues = {
	[widget]: [issue(12, "Ship the legend"), issue(13, "Write the legend copy")],
};

const pulls: Record<string, ReturnType<typeof pull>[]> = {
	[widget]: [pull(widget, 40, "feat: ship the legend", "Closes #12")],
	[launch]: [pull(launch, 77, "fix: ship the launch", "")],
};

function linearTicket(identifier: string, title: string, prUrl?: string) {
	return {
		id: identifier,
		identifier,
		title,
		description: "",
		state: stateOf("Todo"),
		updatedAt: "2026-10-21T12:00:00.000Z",
		history: { nodes: [] },
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		assignee: null,
		attachments: {
			nodes:
				prUrl === undefined
					? []
					: [
							{
								url: prUrl,
								title: "fix: ship the launch",
								sourceType: "github",
							},
						],
		},
		comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
		inverseRelations: { nodes: [] },
	};
}

const launchProject = {
	id: "project-launch",
	name: "Widget launch",
	slugId: "widget-launch-0d42ae5d46d0",
	teams: { nodes: [{ id: "team-wid", key: "WID", name: "Widget" }] },
};

const linear = linearFake({
	project: launchProject,
	states: teamStates,
	issues: [
		linearTicket(
			"WID-14",
			"Ship the launch",
			`https://github.com/${launch}/pull/77`,
		),
		linearTicket("WID-15", "Plan the launch party"),
	],
});

const fetch: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.linear.app/graphql") {
		return linear(input, init);
	}
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const body = typeof init?.body === "string" ? init.body : "";
	if (body.includes("query LinkedPulls")) {
		return Response.json({ data: { repository: { issue: null } } });
	}
	if (url === "https://api.github.com/graphql") {
		return (
			repoReadFromLists(input, init, issues, pulls) ??
			Response.json({ data: {} })
		);
	}
	const single = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/,
	);
	if (single !== null) {
		const found = (pulls[single[1] ?? ""] ?? []).find(
			(item) => item.number === Number(single[2]),
		);
		return found === undefined ? unrecorded(input) : Response.json(found);
	}
	const ticket = url.match(
		/^https:\/\/api\.github\.com\/repos\/acme\/widget\/issues\/(\d+)$/,
	);
	const found = issues[widget]?.find(
		(item) => item.number === Number(ticket?.[1]),
	);
	if (found !== undefined) {
		return Response.json(found);
	}
	if (url.includes("/check-runs") || url.includes("/commits/")) {
		return Response.json({ check_runs: [] });
	}
	if (
		emptyLists(url) ||
		url.includes("/dependencies/") ||
		url.includes("/issues?")
	) {
		return Response.json([]);
	}
	return unrecorded(input);
};

await serveRecorded({
	prefix: "project-flow-415-",
	port: process.argv[2]?.trim() || "4415",
	config: {
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "linear", project: launchProject.slugId },
		],
		checkoutRoots: [],
		pmBot: { [widget]: false },
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[widget]: { openView: "board" },
			[launchProject.name]: { openView: "board" },
		},
	},
	fetch,
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
