import { createServer } from "node:net";
import type { Fetch } from "../src/fetch.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";
import {
	emptyLinear,
	emptyLists,
	serveRecorded,
	unrecorded,
} from "./recorded.ts";

const repo = "acme/widget";
const projectId = "PVT_widget";
const projectTitle = "Widget board";
const end = { hasNextPage: false, endCursor: null };
const ask = "<!-- workcell:ask card-lanes -->\nWhich colour stays?";

const labels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function recordedIssue(
	number: number,
	title: string,
	issueLabels: string[],
	state: "OPEN" | "CLOSED" = "OPEN",
	fields: Record<string, unknown> = {},
) {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-10-18T12:00:00Z",
		createdAt: "2026-10-01T00:00:00Z",
		closedAt: state === "CLOSED" ? "2026-10-18T12:00:00Z" : null,
		body: "",
		comments: { nodes: [], pageInfo: end },
		labels: {
			nodes: issueLabels.map((name) => ({ name, color: "d0d7de" })),
			pageInfo: end,
		},
		assignees: { nodes: [] },
		milestone: null,
		parent: null,
		blockedBy: { nodes: [], pageInfo: end },
		blocking: { nodes: [], pageInfo: end },
		...fields,
	};
}

const blocker = recordedIssue(2, "Open the gate", ["ready"]);
const blocked = recordedIssue(3, "Hold the launch window", [], "OPEN", {
	blockedBy: {
		nodes: [
			{
				number: 2,
				title: "Open the gate",
				state: "OPEN",
				repository: { nameWithOwner: repo },
			},
		],
		pageInfo: end,
	},
});
const needs = recordedIssue(4, "Pick the card colour", ["ready"], "OPEN", {
	comments: {
		nodes: [
			{
				databaseId: 4,
				body: ask,
				createdAt: "2026-10-18T11:00:00Z",
				author: { login: "factory" },
			},
		],
		pageInfo: end,
	},
});
const dropped = recordedIssue(7, "Drop the unused card", [], "CLOSED", {
	stateReason: "NOT_PLANNED",
});
const mergeTicket = recordedIssue(8, "Wait for the merge", ["ready"]);
const issues = [
	recordedIssue(9, "Park the board card", []),
	recordedIssue(1, "Queue the board card", ["ready"]),
	blocker,
	blocked,
	needs,
	recordedIssue(5, "Build the lane tint", ["factory: running"]),
	recordedIssue(6, "Read the review comments", ["factory: in-review"]),
	dropped,
	mergeTicket,
	...Array.from({ length: 6 }, (_, index) =>
		recordedIssue(10 + index, `Close item ${String(index + 1)}`, [], "CLOSED"),
	),
];

const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const codex = "chatgpt-codex-connector[bot]";

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

function projectStatus(
	name: string,
	optionId: string,
	color: string,
): Record<string, unknown> {
	return { name, optionId, color, updatedAt: "2026-10-18T12:00:00Z" };
}

function projectIssue(
	number: number,
	title: string,
	status: Record<string, unknown> | null,
	state: "OPEN" | "CLOSED" = "OPEN",
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		fieldValueByName: status,
		content: {
			__typename: "Issue",
			id: `I_${number}`,
			number,
			title,
			state,
			stateReason: state === "CLOSED" ? "COMPLETED" : null,
			updatedAt: "2026-10-18T12:00:00Z",
			body: "",
			comments: { totalCount: 0 },
			repository: { nameWithOwner: repo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			closedByPullRequestsReferences: { nodes: [], pageInfo: end },
			blockedBy: { nodes: [], pageInfo: end },
			...fields,
		},
	};
}

const statusOptions = [
	{ id: "opt-backlog", name: "Backlog", color: "GRAY" },
	{ id: "opt-ready", name: "Ready", color: "BLUE" },
	{ id: "opt-progress", name: "In progress", color: "YELLOW" },
	{ id: "opt-review", name: "In review", color: "ORANGE" },
	{ id: "opt-merge", name: "Awaiting merge", color: "GREEN" },
	{ id: "opt-done", name: "Done", color: "PURPLE" },
	{ id: "opt-dropped", name: "Dropped", color: "PINK" },
];

const projectItems = [
	projectIssue(
		9,
		"Park the board card",
		projectStatus("Backlog", "opt-backlog", "GRAY"),
	),
	projectIssue(
		1,
		"Queue the board card",
		projectStatus("Ready", "opt-ready", "BLUE"),
	),
	projectIssue(2, "Open the gate", projectStatus("Ready", "opt-ready", "BLUE")),
	projectIssue(
		3,
		"Hold the launch window",
		projectStatus("Backlog", "opt-backlog", "GRAY"),
		"OPEN",
		{
			blockedBy: {
				nodes: [
					{
						number: 2,
						title: "Open the gate",
						state: "OPEN",
						repository: { nameWithOwner: repo },
					},
				],
				pageInfo: end,
			},
		},
	),
	projectIssue(
		4,
		"Pick the card colour",
		projectStatus("Ready", "opt-ready", "BLUE"),
		"OPEN",
		{
			comments: {
				totalCount: 1,
				nodes: [
					{
						databaseId: 4,
						body: ask,
						createdAt: "2026-10-18T11:00:00Z",
						author: { login: "factory" },
					},
				],
			},
		},
	),
	projectIssue(
		5,
		"Build the lane tint",
		projectStatus("In progress", "opt-progress", "YELLOW"),
	),
	projectIssue(
		6,
		"Read the review comments",
		projectStatus("In review", "opt-review", "ORANGE"),
	),
	projectIssue(
		8,
		"Wait for the merge",
		projectStatus("Awaiting merge", "opt-merge", "GREEN"),
		"OPEN",
		{
			closedByPullRequestsReferences: {
				nodes: [{ number: 70, repository: { nameWithOwner: repo } }],
				pageInfo: end,
			},
		},
	),
	...Array.from({ length: 6 }, (_, index) =>
		projectIssue(
			10 + index,
			`Close item ${String(index + 1)}`,
			projectStatus("Done", "opt-done", "PURPLE"),
			"CLOSED",
		),
	),
	projectIssue(
		7,
		"Drop the unused card",
		projectStatus("Dropped", "opt-dropped", "PINK"),
		"CLOSED",
		{
			stateReason: "NOT_PLANNED",
		},
	),
];

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
const appPort = await new Promise<number>((resolve, reject) => {
	const probe = createServer();
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", () => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			reject(new Error("card lane proof has no app port"));
			return;
		}
		const chosen = address.port;
		probe.close(() => resolve(chosen));
	});
});

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

const frameScript = `<script>
document.addEventListener("DOMContentLoaded", () => {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "card-lane-frame";
  button.textContent = "Frame lanes";
  const left = document.createElement("button");
  left.type = "button";
  left.id = "card-lane-frame-left";
  left.textContent = "Frame left lanes";
  const backlog = document.createElement("button");
  backlog.type = "button";
  backlog.id = "card-lane-frame-backlog";
  backlog.textContent = "Frame backlog";
  function frameEnd(edge) {
    const lanes = document.querySelector("[data-lanes]");
    const named = new URLSearchParams(location.search).get("frame") ?? "";
    const framed = named.startsWith("acme/widget#")
      ? document.querySelector("[data-lanes] button[data-ticket='" + named + "']")
      : document.querySelector("[data-ticket='acme/widget#7']");
    if (!(lanes instanceof HTMLElement) || !(framed instanceof HTMLElement)) {
      button.textContent = "lanes missing";
      left.textContent = "lanes missing";
      backlog.textContent = "lanes missing";
      return;
    }
    if (named.startsWith("acme/widget#")) {
      const lane = framed.closest("[data-lanes] > *");
      if (!(lane instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        return;
      }
      const copy = lane.cloneNode(true);
      if (!(copy instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        return;
      }
      const cards = [...copy.querySelectorAll("button[data-ticket]")];
      for (const card of cards) {
        if (card.getAttribute("data-ticket") !== named) {
          card.remove();
        }
      }
      lanes.replaceChildren(copy);
    } else if (edge === "left") {
      lanes.scrollLeft = 0;
    } else if (edge === "backlog") {
      const card = document.querySelector("[data-ticket='acme/widget#9']");
      if (!(card instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        backlog.textContent = "lanes missing";
        return;
      }
      const lane = card.closest("[data-lanes] > *");
      if (!(lane instanceof HTMLElement)) {
        button.textContent = "lanes missing";
        left.textContent = "lanes missing";
        backlog.textContent = "lanes missing";
        return;
      }
      const offset = lane.getBoundingClientRect().left - lanes.getBoundingClientRect().left;
      lanes.scrollLeft += offset;
    } else {
      const offset = framed.getBoundingClientRect().left - lanes.getBoundingClientRect().left;
      lanes.scrollLeft += offset;
    }
    button.textContent = "lanes framed";
    left.textContent = "lanes framed";
    backlog.textContent = "lanes framed";
  }
  button.addEventListener("click", () => {
    frameEnd("right");
  });
  left.addEventListener("click", () => {
    frameEnd("left");
  });
  backlog.addEventListener("click", () => {
    frameEnd("backlog");
  });
  document.body.append(button, left, backlog);
});
</script>`;

Bun.serve({
	hostname: "127.0.0.1",
	port: publicPort,
	async fetch(request) {
		const url = new URL(request.url);
		const target = `http://127.0.0.1:${String(appPort)}${url.pathname}${url.search}`;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				const response = await fetch(target);
				const type = response.headers.get("content-type") ?? "";
				if (!type.includes("text/html")) {
					return response;
				}
				const html = await response.text();
				const headers = new Headers(response.headers);
				headers.delete("content-length");
				return new Response(html.replace("</body>", `${frameScript}</body>`), {
					status: response.status,
					headers,
				});
			} catch {
				await Bun.sleep(100);
			}
		}
		return new Response("card lane proof app did not listen", { status: 503 });
	},
});
