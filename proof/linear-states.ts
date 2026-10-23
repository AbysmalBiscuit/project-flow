/** The workflow states of the invented Linear teams in the proof servers. */
export const states = [
	{ id: "st-backlog", name: "Backlog", type: "backlog", color: "#bec2c8" },
	{ id: "st-todo", name: "Todo", type: "unstarted", color: "#e2e2e2" },
	{ id: "st-progress", name: "In Progress", type: "started", color: "#f2c94c" },
	{ id: "st-done", name: "Done", type: "completed", color: "#5e6ad2" },
] as const;

export type StateName = (typeof states)[number]["name"];

export function stateOf(name: StateName) {
	return states.find((item) => item.name === name) ?? states[0];
}

/** The states as the Linear TeamStates read returns them. */
export const teamStates = states.map((state, position) => ({
	...state,
	position,
}));
