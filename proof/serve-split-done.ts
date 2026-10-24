import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, urlOf } from "../test/support.ts";
import { proofStops } from "./lifetime.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-split-done-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const project = "Split done";
const pin = "split-done";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [{ tracker: "linear", project: pin }],
		pollIntervalSeconds: 3600,
		projectViews: {
			[project]: { maxAgeDays: { Shipped: 2, Released: 2 } },
		},
	}),
);

function splitDoneIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
	updatedAt: string,
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt,
		state,
		history: { nodes: [{ createdAt: updatedAt, toState: { id: state.id } }] },
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		assignee: null,
		attachments: { nodes: [] },
		comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
		inverseRelations: { nodes: [] },
	};
}

const shipped = {
	id: "st-shipped",
	name: "Shipped",
	type: "completed",
	color: "#4cb782",
};
const released = {
	id: "st-released",
	name: "Released",
	type: "completed",
	color: "#5e6ad2",
};
const states = [
	{
		id: "st-backlog",
		name: "Backlog",
		type: "backlog",
		position: 0,
		color: "#bec2c8",
	},
	{
		id: "st-progress",
		name: "In Progress",
		type: "started",
		position: 1,
		color: "#f2c94c",
	},
	{
		id: "st-review",
		name: "In Review",
		type: "started",
		position: 2,
		color: "#4cb782",
	},
	{
		id: "st-merge",
		name: "Awaiting merge",
		type: "started",
		position: 3,
		color: "#bb87fc",
	},
	{ ...shipped, position: 4 },
	{ ...released, position: 5 },
	{
		id: "st-dropped",
		name: "Canceled",
		type: "canceled",
		position: 6,
		color: "#95a2b3",
	},
];
const issues = [
	splitDoneIssue(
		"WID-1",
		"Wait in backlog",
		states[0] ?? shipped,
		"2026-08-18T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-2",
		"Build the split",
		states[1] ?? shipped,
		"2026-08-18T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-3",
		"Review the split",
		states[2] ?? shipped,
		"2026-08-18T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-4",
		"Merge the split",
		states[3] ?? shipped,
		"2026-08-18T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-5",
		"Ship the fresh item",
		shipped,
		"2026-08-17T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-6",
		"Ship the old item",
		shipped,
		"2026-08-01T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-7",
		"Release the fresh item",
		released,
		"2026-08-17T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-8",
		"Release the old item",
		released,
		"2026-08-01T12:00:00.000Z",
	),
	splitDoneIssue(
		"WID-9",
		"Drop the split",
		states[6] ?? shipped,
		"2026-08-17T12:00:00.000Z",
	),
];

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url !== "https://api.linear.app/graphql") {
		return new Response("not recorded", { status: 404 });
	}
	if (body.includes("MemberProjects") || body.includes("viewer { id }")) {
		return Response.json({
			data: { viewer: { id: "lev" }, projects: emptyPage },
		});
	}
	if (body.includes("ProjectByPin")) {
		return Response.json({
			data: {
				projects: {
					nodes: [
						{
							id: pin,
							name: project,
							slugId: pin,
							teams: {
								nodes: [{ id: "team-split", key: "WID", name: "Widget" }],
							},
						},
					],
				},
			},
		});
	}
	if (body.includes("TeamStates")) {
		return Response.json({
			data: { team: { states: { nodes: states } } },
		});
	}
	if (body.includes("ProjectIssues")) {
		return Response.json({
			data: { issues: { nodes: issues, pageInfo: emptyPage.pageInfo } },
		});
	}
	return Response.json({ data: {} });
};

const port = Number(process.argv[2] ?? "4175");
let base = "";
try {
	await run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: { LINEAR_API_KEY: "recorded-linear-key" },
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
		stdout: (line) => {
			base = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: (async () => {
			const stops = proofStops();
			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				if (base !== "") {
					const loaded = await fetch(
						new URL(`/api/projects/${encodeURIComponent(project)}`, base),
					).catch(() => null);
					if (loaded?.ok) {
						const body = (await loaded.json()) as {
							lanes?: { name?: string; statusType?: string }[];
							doneTickets?: { key?: string }[];
						};
						const doneLanes =
							body.lanes?.filter((lane) => lane.statusType === "done") ?? [];
						if (
							doneLanes.length === 2 &&
							(body.doneTickets?.length ?? 0) === 4
						) {
							const internal = new URL(base);
							Bun.serve({
								hostname: "127.0.0.1",
								port,
								fetch(request) {
									const target = new URL(request.url);
									target.protocol = internal.protocol;
									target.hostname = internal.hostname;
									target.port = internal.port;
									return fetch(
										new Request(target, {
											method: request.method,
											headers: request.headers,
											body: request.body,
										}),
									);
								},
							});
							console.log(`http://127.0.0.1:${port}/`);
							await stops;
							return;
						}
					}
				}
				await new Promise((pause) => setTimeout(pause, 50));
			}
			throw new Error("split done board did not load");
		})(),
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
