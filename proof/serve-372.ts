import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
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
import { recordedIssues, serveRecorded } from "./recorded.ts";

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

function projectRead(body: string): Response | null {
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
	if (body.includes("RepoRead") && !body.includes('"name":"gate"')) {
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
	return null;
}

const outside = recordedIssues(outsideIssues);

const recorded: Fetch = async (input, init) => {
	const read =
		urlOf(input) === "https://api.github.com/graphql" &&
		typeof init?.body === "string"
			? projectRead(init.body)
			: null;
	return read ?? outside(input, init);
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
