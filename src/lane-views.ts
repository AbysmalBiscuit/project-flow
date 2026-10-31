import type { UserState } from "./configuration.ts";
import type {
	ProjectReport,
	StatusColours,
	StatusType,
	TicketState,
	TicketView,
} from "./domain.ts";
import { statusTypes } from "./kinds.ts";

const laneFallback: Record<TicketState, string> = {
	done: "Done",
	dropped: "Dropped",
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
};

export function displayedLaneName(ticket: TicketView): string {
	return ticket.lane ?? laneFallback[ticket.state];
}

export function doneTicketsForLane(
	report: ProjectReport,
	lane: string,
): TicketView[] {
	return report.doneTickets.filter(
		(ticket) => displayedLaneName(ticket) === lane,
	);
}

export const appLaneNames: Record<StatusType, string> = {
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
	done: "Done",
	dropped: "Dropped",
};

/** One state per category, in category order. */
export function defaultStates(colours: StatusColours): UserState[] {
	return statusTypes.map((category) => ({
		id: category,
		label: appLaneNames[category],
		colour: colours[category],
		categories: [category],
	}));
}

/** The first state of each category gives the colour of that category. */
export function categoryColours(states: readonly UserState[]): StatusColours {
	const colourOf = (category: StatusType) =>
		states.find((state) => state.categories.includes(category))?.colour ??
		states[0]?.colour ??
		"";
	return {
		backlog: colourOf("backlog"),
		inProgress: colourOf("inProgress"),
		inReview: colourOf("inReview"),
		awaitingMerge: colourOf("awaitingMerge"),
		done: colourOf("done"),
		dropped: colourOf("dropped"),
	};
}
