import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const port = process.argv[2] ?? "4174";
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
			queueMicrotask(() => {
				issues = [
					{
						id: "PF-1",
						identifier: "PF-1",
						title: "Open ask",
						description: "",
						state: { type: "unstarted" },
						updatedAt: "2026-08-18T13:00:00.000Z",
						labels: { nodes: [] },
						comments: { nodes: [{ body: `${question}\n\n${ask}` }] },
					},
				];
			});
			return recordedIssues();
		}
	}
	return new Response("not recorded", { status: 404 });
};

const root = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [{ tracker: "linear", project: "project-flow" }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
	}),
);

await run(["--config", config, "--host", "127.0.0.1", "--port", port], {
	env: { LINEAR_API_KEY: "recorded-linear-key" },
	fetch: recorded,
	readGhToken: async () => null,
	databasePath: join(root, "store.sqlite"),
	now: () => new Date("2026-10-18T12:00:00.000Z"),
	stdout: (line) => {
		console.log(line);
		setTimeout(() => {
			void fetch(new URL("/api/refresh", line), { method: "POST" });
		}, 400);
	},
	waitForStop: new Promise(() => {}),
});
