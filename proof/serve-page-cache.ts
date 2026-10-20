import { serveRecorded } from "./recorded.ts";

const port = process.argv[2] ?? "0";
const mode = process.argv[3] ?? "hold-first";
const repo = "acme/cache";
let reads = 0;
let releaseFirst = () => {};
const firstRead = new Promise<void>((resolve) => {
	releaseFirst = resolve;
});
if (mode === "refresh") {
	releaseFirst();
} else {
	setTimeout(releaseFirst, 12_000);
}



function issue(title: string, repoName = repo): Record<string, unknown> {
	return {
		number: 1,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repoName}/issues/1`,
		updated_at: "2026-08-01T12:00:00.000Z",
		body: "",
		labels: [{ name: "ready" }],
		assignee: null,
	};
}

await serveRecorded({
	prefix: "project-flow-214-",
	port,
	config: {
		theme: "light",
		pinned: [
			{ tracker: "github", repo },
			{ tracker: "github", repo: "acme/release" },
		],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
		notificationTriggers: {
			needsYou: false,
			comment: false,
			blockerCleared: false,
		},
	},
	fetch: async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);

		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return Response.json([]);
		}
		if (
			url.includes("/labels?") ||
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
			if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
				return Response.json({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							organizations: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				});
			}
			return Response.json({
				data: {
					repository: {
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
		if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
			reads += 1;
			const title = reads === 1 ? "Cache marker one" : "Cache marker two";
			if (reads === 1) {
				await firstRead;
			}
			return Response.json([issue(title)]);
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return Response.json([]);
		}
		if (url.startsWith("https://api.github.com/repos/acme/release/issues?")) {
			return Response.json([issue("Release marker", "acme/release")]);
		}
		return new Response("unrecorded", { status: 404 });
	},
});
