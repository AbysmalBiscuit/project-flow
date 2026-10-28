import type { Configuration } from "../../src/configuration.ts";

/** The default state colours, as a fresh configuration file holds them. */
export const defaultStateColours = {
	backlog: "#8a8680",
	inProgress: "#3b6fd8",
	inReview: "#e07a2f",
	awaitingMerge: "#1f9d6a",
	done: "#7c5cbf",
	dropped: "#9ca3af",
};

/** The default states, as a fresh configuration file holds them. */
export const defaultStates: Configuration["states"] = [
	{
		id: "backlog",
		label: "Backlog",
		colour: defaultStateColours.backlog,
		categories: ["backlog"],
	},
	{
		id: "inProgress",
		label: "In progress",
		colour: defaultStateColours.inProgress,
		categories: ["inProgress"],
	},
	{
		id: "inReview",
		label: "In review",
		colour: defaultStateColours.inReview,
		categories: ["inReview"],
	},
	{
		id: "awaitingMerge",
		label: "Awaiting merge",
		colour: defaultStateColours.awaitingMerge,
		categories: ["awaitingMerge"],
	},
	{
		id: "done",
		label: "Done",
		colour: defaultStateColours.done,
		categories: ["done"],
	},
	{
		id: "dropped",
		label: "Dropped",
		colour: defaultStateColours.dropped,
		categories: ["dropped"],
	},
];

export async function writtenStates(path: string): Promise<unknown> {
	const written = JSON.parse(await Bun.file(path).text()) as {
		states?: unknown;
	};
	return written.states;
}
