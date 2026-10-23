/**
 * Serves a `Colour Board` Linear project with the recorded Linear tickets,
 * one in progress and two not started, for the state colour settings.
 *
 * Usage: bun proof/serve-456.ts [PORT] [light|dark]
 */
import recordedTeam from "../test/fixtures/linear-team-states.json";
import outsideRelations from "../test/fixtures/outside-relations.json";
import { linearFake } from "../test/support.ts";
import { serveRecorded } from "./recorded.ts";

const project = {
	id: "project-colour",
	name: "Colour Board",
	slugId: "colour-board-4c56a1b2d3e4",
	teams: { nodes: [{ id: "team-aut", key: "AUT", name: "AUT" }] },
};

const teamStates = recordedTeam.data.team.states.nodes;

// The ticket recordings hold only the state type. Each ticket gets the
// recorded team state that the board names for that type.
const stateNames: Record<string, string> = {
	started: "In Progress",
	unstarted: "Todo",
};

function stateOf(type: string) {
	const recorded = teamStates.find((item) => item.name === stateNames[type]);
	if (recorded === undefined) {
		throw new Error(`no recorded state for type ${type}`);
	}
	const { position: _, ...state } = recorded;
	return state;
}

const issues = [
	outsideRelations.linearAut1040,
	outsideRelations.linearSwe13029,
	outsideRelations.linearOps3838,
].map((ticket) => ({
	...ticket,
	id: ticket.identifier.toLowerCase(),
	state: stateOf(ticket.state.type),
	attachments: { nodes: [] },
}));

await serveRecorded({
	prefix: "project-flow-456-",
	port: process.argv[2]?.trim() || "4456",
	config: {
		pinned: [{ tracker: "linear", project: project.slugId }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: process.argv[3] === "dark" ? "dark" : "light",
		projectViews: { [project.name]: { openView: "board" } },
	},
	fetch: linearFake({
		project,
		states: teamStates,
		issues,
	}),
	now: () => new Date("2026-10-22T12:00:00.000Z"),
});
