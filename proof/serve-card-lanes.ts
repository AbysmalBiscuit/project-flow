import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	ask,
	codex,
	end,
	head,
	issues,
	labels,
	older,
	projectId,
	projectItems,
	projectTitle,
	repo,
	statusOptions,
} from "./card-lane-board.ts";
import { frameScript } from "./card-lane-frame.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";
import { freePort, serveInjecting } from "./serve-proxy.ts";

function recordedPull(): Response {
	return Response.json({
		data: {
			repository: {
				nameWithOwner: repo,
				autoMergeAllowed: false,
				refs: { nodes: [], pageInfo: end },
				labels: { nodes: labels, pageInfo: end },
				issues: { nodes: issues, pageInfo: end },
				openPullRequests: {
					nodes: [
						{
							number: 70,
							title: "Wait for the merge",
							url: `https://github.com/${repo}/pull/70`,
							isDraft: false,
							body: "Closes #8",
							state: "OPEN",
							mergedAt: null,
							headRefName: "70-feat-merge",
							headRefOid: head,
							autoMergeRequest: null,
							commits: {
								nodes: [
									{
										commit: {
											committedDate: "2026-10-18T10:00:00Z",
										},
									},
								],
								pageInfo: end,
							},
							closingIssuesReferences: {
								nodes: [{ number: 8 }],
								pageInfo: end,
							},
							reviews: { nodes: [], pageInfo: end },
							comments: {
								nodes: [
									{
										author: { login: codex },
										body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `aaaaaaaa` | PR opened |",
										createdAt: "2026-10-18T11:00:00Z",
										reactions: { totalCount: 0 },
									},
								],
								pageInfo: end,
							},
							reactions: { nodes: [], pageInfo: end },
							statusCheckRollup: {
								contexts: { nodes: [], pageInfo: end },
							},
						},
					],
					pageInfo: end,
				},
				mergedPullRequests: {
					nodes: [
						{
							number: 1,
							title: "merged",
							url: `https://github.com/${repo}/pull/1`,
							isDraft: false,
							body: "",
							state: "MERGED",
							mergedAt: "2026-10-01T00:00:00Z",
							headRefName: "1-merged",
							headRefOid: older,
							autoMergeRequest: null,
							commits: { nodes: [], pageInfo: end },
							closingIssuesReferences: { nodes: [], pageInfo: end },
							reviews: {
								nodes: [
									{
										author: { login: codex },
										commit: { oid: older },
										state: "APPROVED",
									},
								],
								pageInfo: end,
							},
							comments: { nodes: [], pageInfo: end },
							reactions: { nodes: [], pageInfo: end },
							statusCheckRollup: {
								contexts: { nodes: [], pageInfo: end },
							},
						},
					],
					pageInfo: end,
				},
			},
		},
	});
}

function recordedRepo(): Response {
	return Response.json({
		data: {
			repository: {
				nameWithOwner: repo,
				autoMergeAllowed: false,
				refs: { nodes: [], pageInfo: end },
				labels: { nodes: labels, pageInfo: end },
				issues: { nodes: issues, pageInfo: end },
				openPullRequests: { nodes: [], pageInfo: end },
				mergedPullRequests: { nodes: [], pageInfo: end },
			},
		},
	});
}

function recordedProject(): Response {
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

function recordedFields(): Response {
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

function recordedItems(): Response {
	return Response.json({
		data: {
			node: {
				items: { nodes: projectItems, pageInfo: end },
			},
		},
	});
}

function recordedComments(number: number): Response {
	if (number !== 4) {
		return Response.json([]);
	}
	return Response.json([
		{
			id: 4,
			body: ask,
			created_at: "2026-10-18T11:00:00Z",
			user: { login: "factory" },
		},
	]);
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
	if (url.includes("/issues/4/comments")) {
		return recordedComments(4);
	}
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return Response.json([]);
	}
	if (url.includes("/pulls/40")) {
		return Response.json({
			number: 40,
			title: "Pick the card colour",
			html_url: `https://github.com/${repo}/pull/40`,
			state: "closed",
			draft: false,
			merged_at: null,
			body: "Closes #4",
			head: { ref: "40-feat-colour", sha: head },
			user: { login: "lev" },
		});
	}
	if (url.includes("/pulls/70")) {
		return Response.json({
			number: 70,
			title: "Wait for the merge",
			html_url: `https://github.com/${repo}/pull/70`,
			state: "open",
			draft: false,
			merged_at: null,
			body: "Closes #8",
			head: { ref: "70-feat-merge", sha: head },
			user: { login: "lev" },
		});
	}
	if (url.includes("/check-runs")) {
		return Response.json({
			check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
		});
	}
	if (
		url.includes("/pulls/70/comments") ||
		url.includes("/issues/70/comments")
	) {
		return Response.json([
			{
				id: 70,
				body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `aaaaaaaa` | PR opened |",
				created_at: "2026-10-18T11:00:00Z",
				user: { login: codex },
				reactions: { total_count: 0 },
			},
		]);
	}
	if (url.includes("/pulls/70/reviews")) {
		return Response.json([
			{
				user: { login: codex },
				commit_id: head,
				state: "APPROVED",
			},
		]);
	}
	if (
		url.includes("/pulls/70/reactions") ||
		url.includes("/issues/70/reactions")
	) {
		return Response.json([]);
	}
	if (url.includes(`/commits/${head}`)) {
		return Response.json({
			sha: head,
			commit: { committer: { date: "2026-10-18T10:00:00Z" } },
		});
	}
	if (url.includes("/pulls?")) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("ProjectByNumber")) {
			return recordedProject();
		}
		if (body.includes("ProjectFields")) {
			return recordedFields();
		}
		if (body.includes("ProjectItems")) {
			return recordedItems();
		}
		if (body.includes("RepoRead")) {
			if (body.includes("openPullRequests")) {
				return recordedPull();
			}
			return recordedRepo();
		}
		return Response.json({
			data: {
				repository: { nameWithOwner: repo, autoMergeAllowed: false },
			},
		});
	}
	return unrecorded(input);
};

const publicPort = Number(process.argv[2] ?? "4197");
const appPort = await freePort();

void serveRecorded({
	prefix: "project-flow-card-lanes-",
	port: String(appPort),
	config: {
		pinned: [{ tracker: "github", owner: "acme", project: 4 }],
		checkoutRoots: [],
		pmBot: { [projectId]: false, [repo]: false },
		expectedBots: { [repo]: ["codex"] },
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: {
			[projectTitle]: {
				openView: "board",
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
}).catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});

serveInjecting({
	port: publicPort,
	appPort,
	inject: frameScript,
	attempts: 50,
	forwardRequest: false,
	name: "card lane proof",
});
