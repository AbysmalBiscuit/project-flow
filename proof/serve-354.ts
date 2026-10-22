/**
 * Serves an `Initial SDI Issues` Linear project with nested parent tickets on
 * the project graph.
 *
 * Usage: bun proof/serve-354.ts [PORT]
 */
import { linearFake } from "../test/support.ts";
import { serveRecorded } from "./recorded.ts";

const slug = "initial-sdi-issues-5b1d0c7e2f3a";
const project = "Initial SDI Issues";

const states = [
	{ id: "st-backlog", name: "Backlog", type: "backlog", color: "#bec2c8" },
	{ id: "st-todo", name: "Todo", type: "unstarted", color: "#e2e2e2" },
	{ id: "st-progress", name: "In Progress", type: "started", color: "#f2c94c" },
	{ id: "st-done", name: "Done", type: "completed", color: "#5e6ad2" },
] as const;

type StateName = (typeof states)[number]["name"];

function sdiTicket(
	id: string,
	title: string,
	state: StateName,
	parent: string | null,
	blockers: string[] = [],
): Record<string, unknown> {
	const found = states.find((item) => item.name === state) ?? states[0];
	return {
		identifier: id,
		title,
		description: "",
		state: found,
		updatedAt: "2026-10-21T12:00:00.000Z",
		history: { nodes: [] },
		parent: parent === null ? null : { identifier: parent },
		projectMilestone: { name: "Initial SDI" },
		labels: { nodes: [] },
		assignee: null,
		attachments: { nodes: [] },
		comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
		inverseRelations: {
			nodes: blockers.map((blocker) => ({
				type: "blocks",
				issue: {
					identifier: blocker,
					title: blocker,
					state: { type: "unstarted" },
					project: { slugId: slug },
				},
			})),
		},
	};
}

// Invented tickets, because a proof run must not read a live tracker.
// SDI-1 > SDI-2 > SDI-4 gives three nested parent ticket frames.
const issues = [
	sdiTicket("SDI-1", "Stand up the SDI pipeline", "In Progress", null),
	sdiTicket("SDI-2", "Ingest the source exports", "In Progress", "SDI-1"),
	sdiTicket("SDI-3", "Parse the CSV exports", "Done", "SDI-2"),
	sdiTicket("SDI-4", "Validate the export schema", "In Progress", "SDI-2"),
	sdiTicket("SDI-13", "Check the date columns", "Todo", "SDI-4"),
	sdiTicket("SDI-14", "Check the id columns", "Backlog", "SDI-4"),
	sdiTicket("SDI-5", "Publish the search index", "Backlog", "SDI-1", [
		"SDI-14",
	]),
	sdiTicket("SDI-9", "Write the SDI runbook", "Todo", null),
	sdiTicket("SDI-10", "Move the SDI archive", "In Progress", null),
	sdiTicket("SDI-11", "Copy the archive files", "Done", "SDI-10"),
	sdiTicket("SDI-12", "Check the copied files", "Todo", "SDI-11"),
];

const fetch = linearFake({
	project: {
		id: "project-sdi",
		name: project,
		slugId: slug,
		teams: { nodes: [{ id: "team-sdi", key: "SDI", name: "SDI" }] },
	},
	states: states.map((state, position) => ({ ...state, position })),
	issues,
});

await serveRecorded({
	prefix: "project-flow-354-",
	port: process.argv[2]?.trim() || "4354",
	config: {
		pinned: [{ tracker: "linear", project: slug }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
		projectViews: {
			[project]: {
				openView: "graph",
				groupBy: "workstream",
				graphDirection: "left-to-right",
			},
		},
	},
	fetch,
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
