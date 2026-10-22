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
const blocked = recordedIssue(3, "Hold the launch window", ["ready"], "OPEN", {
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
	if (emptyLists(url) || url.includes("/dependencies/")) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
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
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		expectedBots: { [repo]: ["codex"] },
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: {
			[repo]: {
				openView: "board",
				groupBy: "none",
				shownLanes: [
					"ready",
					"factory: running",
					"factory: in-review",
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
  button.addEventListener("click", () => {
    const board = document.querySelector("[data-lanes]");
    const dropped = document.querySelector("[data-ticket='acme/widget#7']");
    if (board === null || dropped === null) {
      button.textContent = "lanes missing";
      return;
    }
    dropped.scrollIntoView({ inline: "end", block: "nearest" });
    button.textContent = "lanes framed";
  });
  document.body.append(button);
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
