/**
 * Serves an `Initial SDI Issues` Linear project with nested parent tickets on
 * the project graph.
 *
 * Usage: bun proof/serve-354.ts [PORT]
 */
import { linearFake } from "../test/support/linear.ts";
import { type StateName, stateOf, teamStates } from "./linear-states.ts";
import { serveRecorded } from "./recorded.ts";

const slug = "initial-sdi-issues-5b1d0c7e2f3a";
const project = "Initial SDI Issues";

function sdiTicket(
	id: string,
	title: string,
	state: StateName,
	parent: string | null,
	blockers: string[] = [],
	milestone = "Initial SDI",
): Record<string, unknown> {
	const found = stateOf(state);
	return {
		identifier: id,
		title,
		description: "",
		state: found,
		updatedAt: "2026-10-21T12:00:00.000Z",
		history: { nodes: [] },
		parent: parent === null ? null : { identifier: parent },
		projectMilestone: { name: milestone },
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
// SDI-1 > SDI-2 > SDI-4 gives three nested parent ticket frames, and SDI-15
// repeats the SDI-1 card as the head of a frame in the Search milestone.
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
	sdiTicket("SDI-15", "Rank the search results", "Todo", "SDI-1", [], "Search"),
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
	states: teamStates,
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
