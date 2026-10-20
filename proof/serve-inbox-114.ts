import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Notification } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { sqliteStore } from "../src/store.ts";

const ask = "<!-- workcell:ask pf-1 -->";
const question = "Which bot should review this?";

let issues: Record<string, unknown>[] = [];

function recordedIssues(): Response {
	return Response.json({
		data: {
			issues: {
				nodes: issues,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

const recorded: Fetch = async (input, init) => {
	const url = String(input instanceof Request ? input.url : input);
	const body = typeof init?.body === "string" ? init.body : "";

	if (url === "https://api.linear.app/graphql") {
		if (body.includes("MemberProjects") || body.includes("viewer { id }")) {
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
		if (body.includes("ProjectByPin")) {
			return Response.json({
				data: {
					projects: {
						nodes: [
							{
								id: "project-flow",
								name: "Project Flow",
								slugId: "project-flow",
							},
						],
					},
				},
			});
		}
		if (body.includes("ProjectIssues")) {
			return recordedIssues();
		}
		if (body.includes("IssueThread")) {
			const current = issues[0];
			const title = body.includes("PF-2")
				? "New comment on #72 from grok-72"
				: typeof current?.title === "string"
					? current.title
					: "Open ask";
			const identifier = body.includes("PF-2")
				? "PF-2"
				: typeof current?.identifier === "string"
					? current.identifier
					: "PF-1";
			return Response.json({
				data: {
					issue: {
						identifier,
						title,
						url: `https://linear.app/project-flow/issue/${identifier}`,
						comments: {
							nodes: [
								{
									id: "comment-1",
									body: "Which bot should review this?",
									createdAt: "2026-08-18T13:00:00.000Z",
									url: `https://linear.app/project-flow/issue/${identifier}#comment-1`,
									parent: null,
									user: { name: "Ada", displayName: "Ada" },
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
	}
	return new Response("not recorded", { status: 404 });
};

function seedInbox(databasePath: string): void {
	const opened = sqliteStore(databasePath);
	const rows: Notification[] = [
		{
			id: "needsYou\nProject Flow\nPF-1\n2026-10-18T14:12:00.000Z",
			trigger: "needsYou",
			project: "Project Flow",
			key: "PF-1",
			text: "Which bot should review this?",
			at: "2026-10-18T14:12:00.000Z",
			read: false,
		},
		{
			id: "comment\nProject Flow\nPF-2\n2026-10-18T14:02:00.000Z",
			trigger: "comment",
			project: "Project Flow",
			key: "PF-2",
			text: "New comment on #72 from grok-72",
			at: "2026-10-18T14:02:00.000Z",
			read: false,
		},
		{
			id: "blockerCleared\nProject Flow\nlinear\nPF-3\n2026-10-18T13:47:00.000Z",
			trigger: "blockerCleared",
			project: "Project Flow",
			key: "PF-3",
			text: "devkit#212 closed, #80 can start",
			at: "2026-10-18T13:47:00.000Z",
			read: false,
		},
		{
			id: "needsYou\nProject Flow\nPF-4\n2026-10-18T13:31:00.000Z",
			trigger: "needsYou",
			project: "Project Flow",
			key: "PF-4",
			text: "Ask 53-2 on #53 waits for an answer",
			at: "2026-10-18T13:31:00.000Z",
			read: true,
		},
		{
			id: "comment\nworkcell\n#431\n2026-10-18T12:58:00.000Z",
			trigger: "comment",
			project: "workcell",
			key: "#431",
			text: "New comment on PR #431 from codex-reviewer",
			at: "2026-10-18T12:58:00.000Z",
			read: true,
		},
		{
			id: "needsYou\nPlatform\nPLAT-212\n2026-10-18T11:20:00.000Z",
			trigger: "needsYou",
			project: "Platform",
			key: "PLAT-212",
			text: "PLAT-212 asks a question about the billing export",
			at: "2026-10-18T11:20:00.000Z",
			read: false,
		},
		{
			id: "blockerCleared\nPlatform\nlinear\nPLAT-15\n2026-10-17T18:44:00.000Z",
			trigger: "blockerCleared",
			project: "Platform",
			key: "PLAT-15",
			text: "project-flow#15 closed, PLAT-198 can start",
			at: "2026-10-17T18:44:00.000Z",
			read: true,
		},
		{
			id: "comment\nworkcell\n#426\n2026-10-17T16:05:00.000Z",
			trigger: "comment",
			project: "workcell",
			key: "#426",
			text: "New comment on #426 from lev",
			at: "2026-10-17T16:05:00.000Z",
			read: true,
		},
		{
			id: "needsYou\nProject Flow\nPF-78\n2026-10-17T09:12:00.000Z",
			trigger: "needsYou",
			project: "Project Flow",
			key: "PF-78",
			text: "PR #78 is ready to merge",
			at: "2026-10-17T09:12:00.000Z",
			read: true,
		},
	];
	opened.store.appendNotifications(rows);
	opened.close();
}

issues = [
	{
		id: "PF-1",
		identifier: "PF-1",
		title: "Open ask",
		description: "",
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T13:00:00.000Z",
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		assignee: null,
		attachments: { nodes: [] },
		comments: {
			nodes: [
				{
					id: "comment-1",
					body: `${question}\n\n${ask}`,
					createdAt: "2026-08-18T13:00:00.000Z",
					user: { name: "Ada", displayName: "Ada" },
					reactions: [],
				},
			],
			pageInfo: { hasNextPage: false, endCursor: null },
		},
		inverseRelations: { nodes: [] },
	},
];

const port = process.argv[2] ?? "4189";
const rootDir = process.argv[3] ?? "/var/tmp";
const root = await mkdtemp(join(rootDir, "project-flow-proof-"));
const databasePath = join(root, "store.sqlite");
seedInbox(databasePath);
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [{ tracker: "linear", project: "project-flow" }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	}),
);
const stop = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});
try {
	await run(["--config", config, "--host", "127.0.0.1", "--port", port], {
		env: { LINEAR_API_KEY: "recorded-linear-key" },
		fetch: recorded,
		readGhToken: async () => null,
		databasePath,
		now: () => new Date("2026-10-18T14:30:00.000Z"),
		stdout: (line) => {
			console.log(line);
		},
		waitForStop: stop,
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
