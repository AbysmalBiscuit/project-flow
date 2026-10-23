/**
 * Serves a `Colour Board` Linear project with tickets in Backlog, In progress
 * and Done, for the state colour settings.
 *
 * Usage: bun proof/serve-456.ts [PORT] [light|dark]
 */
import { linearFake } from "../test/support.ts";
import { type StateName, stateOf, teamStates } from "./linear-states.ts";
import { serveRecorded } from "./recorded.ts";

const slug = "colour-board-4c56a1b2d3e4";
const project = "Colour Board";

function ticket(id: string, title: string, state: StateName) {
	return {
		identifier: id,
		title,
		description: "",
		state: stateOf(state),
		updatedAt: "2026-10-21T12:00:00.000Z",
		history: { nodes: [] },
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		assignee: null,
		attachments: { nodes: [] },
		comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
		inverseRelations: { nodes: [] },
	};
}

// Invented tickets, because a proof run must not read a live tracker.
const issues = [
	ticket("COL-1", "Sketch the palette", "Backlog"),
	ticket("COL-2", "Pick the hue", "Todo"),
	ticket("COL-3", "Paint the board", "In Progress"),
	ticket("COL-4", "Paint the graph", "In Progress"),
	ticket("COL-5", "Mix the base colours", "Done"),
];

await serveRecorded({
	prefix: "project-flow-456-",
	port: process.argv[2]?.trim() || "4456",
	config: {
		pinned: [{ tracker: "linear", project: slug }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: { [project]: { openView: "board" } },
	},
	fetch: linearFake({
		project: {
			id: "project-colour",
			name: project,
			slugId: slug,
			teams: { nodes: [{ id: "team-col", key: "COL", name: "COL" }] },
		},
		states: teamStates,
		issues,
	}),
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
