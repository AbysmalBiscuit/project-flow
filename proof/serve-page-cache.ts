import { Database } from "bun:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serveRecorded } from "./recorded.ts";

const port = process.argv[2] ?? "0";
const mode = process.argv[3] ?? "hold-first";
const repo = "acme/cache";
const laterAt = "2026-10-18T12:00:01.000Z";
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

function markChanged(databasePath: string): void {
	const db = new Database(databasePath);
	db.run(
		"insert or ignore into notifications (id, trigger, project, item_key, text, at, read) values (?, ?, ?, ?, ?, ?, ?)",
		[
			"page-cache-marker",
			"comment",
			repo,
			`${repo}#1`,
			"Inbox marker two",
			"2026-10-18T11:00:00.000Z",
			0,
		],
	);
	db.close();
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
		labels: [{ name: "needs-human" }],
		assignee: { login: "lev" },
		assignees: [{ login: "lev" }],
	};
}

const dir = join("/var/tmp", `project-flow-214-${crypto.randomUUID()}`);
await mkdir(dir, { recursive: true });
const databasePath = join(dir, "project-flow.sqlite");
if (mode === "refresh") {
	setTimeout(() => {
		const configPath = join(dir, "config.json");
		void readFile(configPath, "utf8")
			.then((text) => {
				const saved = JSON.parse(text) as {
					pollIntervalSeconds?: number;
					pinned?: { tracker: string; repo: string }[];
				};
				saved.pollIntervalSeconds = 90;
				saved.pinned = [
					{ tracker: "github", repo },
					{ tracker: "github", repo: "acme/widgets" },
				];
				return writeFile(configPath, `${JSON.stringify(saved)}\n`);
			})
			.then(() =>
				fetch(`http://127.0.0.1:${port}/api/refresh`, { method: "POST" }),
			);
	}, 8_000);
}

await serveRecorded({
	prefix: "project-flow-214-",
	port,
	dir,
	databasePath,
	configPath: join(dir, "config.json"),
	config: {
		theme: "light",
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		needsYouLabels: ["needs-human"],
		pollIntervalSeconds: 7200,
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
		if (url === `https://api.github.com/repos/${repo}`) {
			return Response.json({ allow_auto_merge: false });
		}
		if (url === "https://api.github.com/repos/acme/widgets") {
			return Response.json({ allow_auto_merge: false });
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
			if (reads === 1) {
				await firstRead;
				return Response.json([issue("Cache marker one")]);
			}
			if (mode === "refresh") {
				markChanged(databasePath);
			}
			return Response.json([
				{
					...issue("Cache marker two"),
					updated_at: laterAt,
				},
			]);
		}
		if (url.startsWith("https://api.github.com/repos/acme/widgets/issues?")) {
			return Response.json([issue("Widget marker", "acme/widgets")]);
		}
		return new Response("unrecorded", { status: 404 });
	},
});
