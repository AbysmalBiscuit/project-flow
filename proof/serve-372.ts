import type { Fetch } from "../src/fetch.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import {
	end,
	issues,
	labels,
	projectId,
	projectItems,
	projectTitle,
	repo,
	statusOptions,
} from "./card-lane-board.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const outsideRepo = "acme/gate";

const outsideIssues = {
	[outsideRepo]: [
		{
			number: 4,
			title: "Hold the platform",
			state: "open",
			state_reason: null,
			updated_at: "2026-10-18T12:00:00Z",
			body: "",
			html_url: `https://github.com/${outsideRepo}/issues/4`,
			comments: 0,
			labels: [],
			assignee: null,
			milestone: null,
		},
	],
};

const blockers: Record<number, { number: number; repo: string }[]> = {
	1: [{ number: 10, repo }],
	3: [{ number: 2, repo }],
	5: [{ number: 1, repo }],
	6: [{ number: 5, repo }],
	8: [{ number: 6, repo }],
	4: [{ number: 7, repo }],
	9: [{ number: 4, repo: outsideRepo }],
};

function blockedBy(number: number) {
	return {
		nodes: (blockers[number] ?? []).map((blocker) => ({
			number: blocker.number,
			title:
				blocker.repo === outsideRepo
					? "Hold the platform"
					: `Ticket ${String(blocker.number)}`,
			state: "OPEN",
			repository: { nameWithOwner: blocker.repo },
		})),
		pageInfo: end,
	};
}

function numberOf(item: Record<string, unknown>): number {
	return typeof item.number === "number" ? item.number : 0;
}

const linkedIssues = issues.map((item) => ({
	...item,
	blockedBy: blockedBy(numberOf(item)),
}));

const linkedItems = projectItems.map((item) => {
	const content = item.content as Record<string, unknown>;
	return {
		...item,
		content: {
			...content,
			blockedBy: blockedBy(numberOf(content)),
			closedByPullRequestsReferences: { nodes: [], pageInfo: end },
		},
	};
});

function graphql(body: string): Response {
	if (body.includes("ProjectByNumber")) {
		return Response.json({
			data: {
				repositoryOwner: {
					projectV2: {
						id: projectId,
						number: 4,
						title: projectTitle,
						closed: false,
						updatedAt: "2026-10-18T12:00:00Z",
					},
				},
			},
		});
	}
	if (body.includes("ProjectFields")) {
		return Response.json({
			data: {
				node: {
					fields: {
						nodes: [
							{ id: "PVTSSF_status", name: "Status", options: statusOptions },
						],
					},
				},
			},
		});
	}
	if (body.includes("ProjectItems")) {
		return Response.json({
			data: { node: { items: { nodes: linkedItems, pageInfo: end } } },
		});
	}
	if (body.includes("RepoRead")) {
		return Response.json({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
					refs: { nodes: [], pageInfo: end },
					labels: { nodes: labels, pageInfo: end },
					issues: { nodes: linkedIssues, pageInfo: end },
					openPullRequests: { nodes: [], pageInfo: end },
					mergedPullRequests: { nodes: [], pageInfo: end },
				},
			},
		});
	}
	return Response.json({
		data: { repository: { nameWithOwner: repo, autoMergeAllowed: false } },
	});
}

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
	if (
		emptyLists(url) ||
		url.includes("/dependencies/") ||
		url.includes("/comments") ||
		url.includes("/pulls?") ||
		url.includes("/check-runs")
	) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes('"name":"gate"')) {
			return (
				repoReadFromLists(input, init, outsideIssues) ??
				Response.json({ data: {} })
			);
		}
		return graphql(typeof init?.body === "string" ? init.body : "");
	}
	return unrecorded(input);
};

const port = process.argv[2] ?? process.env.PORT ?? "4372";

await serveRecorded({
	prefix: "project-flow-372-",
	port,
	config: {
		pinned: [
			{ tracker: "github", owner: "acme", project: 4 },
			{ tracker: "github", repo: outsideRepo },
		],
		checkoutRoots: [],
		pmBot: { [projectId]: false, [repo]: false, [outsideRepo]: false },
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: {
			[projectTitle]: {
				openView: process.argv[4] === "graph" ? "graph" : "board",
				groupBy: "none",
				shownLanes: [
					"Backlog",
					"Ready",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				],
				maxAgeDays: { Done: 0 },
			},
		},
	},
	fetch: recorded,
});
