import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { proofStops } from "./lifetime.ts";

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

export async function runLinearProof(
	proofPort: string,
	proofRoot: string,
	onListen: (line: string) => void,
	onStop?: () => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(proofRoot, "project-flow-proof-"));
	const config = join(root, "config.json");
	await writeFile(
		config,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "project-flow" }],
			checkoutRoots: [],
			pollIntervalSeconds: 3600,
		}),
	);
	try {
		await run(
			["--config", config, "--host", "127.0.0.1", "--port", proofPort],
			{
				env: { LINEAR_API_KEY: "recorded-linear-key" },
				fetch: recorded,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: onListen,
				waitForStop: proofStops(),
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
	let timer: ReturnType<typeof setTimeout> | undefined;
	await runLinearProof(
		port,
		rootDir,
		(line) => {
			console.log(line);
			const arm = async () => {
				const inbox = await fetch(new URL("/inbox", line));
				if (!inbox.ok) {
					timer = setTimeout(() => {
						void arm();
					}, 200);
					return;
				}
				releaseLinearAsk();
				await fetch(new URL("/api/refresh", line), { method: "POST" });
			};
			timer = setTimeout(() => {
				void arm();
			}, 200);
		},
		async () => {
			clearTimeout(timer);
		},
	);
}
