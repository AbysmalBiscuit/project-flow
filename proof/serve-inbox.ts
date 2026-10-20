import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

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

export function releaseLinearAsk(): void {
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
}

function seedInbox(databasePath: string): void {
	const seeded = new Database(databasePath);
	seeded.run(`
		create table if not exists notifications (
			id text primary key,
			trigger text not null,
			project text not null,
			item_key text not null,
			text text not null,
			at text not null,
			read integer not null default 0
		)
	`);
	const columns = seeded.query("pragma table_info(notifications)").all() as {
		name: string;
	}[];
	if (!columns.some((column) => column.name === "read")) {
		seeded.run(
			"alter table notifications add column read integer not null default 0",
		);
	}
	const insert = seeded.query(
		"insert or ignore into notifications (id, trigger, project, item_key, text, at, read) values (?, ?, ?, ?, ?, ?, ?)",
	);
	const rows: [string, string, string, string, string, string, number][] = [
		[
			"needsYou\nProject Flow\nPF-1\n2026-10-18T14:12:00.000Z",
			"needsYou",
			"Project Flow",
			"PF-1",
			"Which bot should review this?",
			"2026-10-18T14:12:00.000Z",
			0,
		],
		[
			"comment\nProject Flow\nPF-2\n2026-10-18T14:02:00.000Z",
			"comment",
			"Project Flow",
			"PF-2",
			"New comment on #72 from grok-72",
			"2026-10-18T14:02:00.000Z",
			0,
		],
		[
			"blockerCleared\nProject Flow\nlinear\nPF-3\n2026-10-18T13:47:00.000Z",
			"blockerCleared",
			"Project Flow",
			"PF-3",
			"devkit#212 closed, #80 can start",
			"2026-10-18T13:47:00.000Z",
			0,
		],
		[
			"needsYou\nProject Flow\nPF-4\n2026-10-18T13:31:00.000Z",
			"needsYou",
			"Project Flow",
			"PF-4",
			"Ask 53-2 on #53 waits for an answer",
			"2026-10-18T13:31:00.000Z",
			1,
		],
		[
			"comment\nworkcell\n#431\n2026-10-18T12:58:00.000Z",
			"comment",
			"workcell",
			"#431",
			"New comment on PR #431 from codex-reviewer",
			"2026-10-18T12:58:00.000Z",
			1,
		],
		[
			"needsYou\nPlatform\nPLAT-212\n2026-10-18T11:20:00.000Z",
			"needsYou",
			"Platform",
			"PLAT-212",
			"PLAT-212 asks a question about the billing export",
			"2026-10-18T11:20:00.000Z",
			0,
		],
		[
			"blockerCleared\nPlatform\nlinear\nPLAT-15\n2026-10-17T18:44:00.000Z",
			"blockerCleared",
			"Platform",
			"PLAT-15",
			"project-flow#15 closed, PLAT-198 can start",
			"2026-10-17T18:44:00.000Z",
			1,
		],
		[
			"comment\nworkcell\n#426\n2026-10-17T16:05:00.000Z",
			"comment",
			"workcell",
			"#426",
			"New comment on #426 from lev",
			"2026-10-17T16:05:00.000Z",
			1,
		],
		[
			"needsYou\nProject Flow\nPF-78\n2026-10-17T09:12:00.000Z",
			"needsYou",
			"Project Flow",
			"PF-78",
			"PR #78 is ready to merge",
			"2026-10-17T09:12:00.000Z",
			1,
		],
	];
	seeded.transaction(() => {
		for (const row of rows) {
			insert.run(...row);
		}
	})();
	seeded.close();
}

let proofStore = "";

export function proofDatabase(root: string): string {
	return join(root, "store.sqlite");
}

export async function runLinearProof(
	proofPort: string,
	proofRoot: string,
	onListen: (line: string) => void,
	onStop?: () => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(proofRoot, "project-flow-proof-"));
	const databasePath = proofDatabase(root);
	proofStore = databasePath;
	seedInbox(databasePath);
	const config = join(root, "config.json");
	await writeFile(
		config,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "project-flow" }],
			checkoutRoots: [],
			pollIntervalSeconds: 3600,
		}),
	);
	const stop = new Promise<void>((resolve) => {
		const done = () => resolve();
		process.once("SIGINT", done);
		process.once("SIGTERM", done);
	});
	try {
		await run(
			["--config", config, "--host", "127.0.0.1", "--port", proofPort],
			{
				env: { LINEAR_API_KEY: "recorded-linear-key" },
				fetch: recorded,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date("2026-10-18T14:30:00.000Z"),
				stdout: onListen,
				waitForStop: stop,
			},
		);
	} finally {
		await onStop?.();
		await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const port = process.argv[2] ?? "4174";
	const rootDir = process.argv[3] ?? "/var/tmp";
	await runLinearProof(
		port,
		rootDir,
		(line) => {
			console.log(line);
		},
		async () => {},
	);
}
