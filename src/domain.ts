export type TicketState = "done" | "dropped" | "backlog";

export type Ticket = {
	tracker: "github" | "linear";
	state: "open" | "closed";
	stateReason: string | null;
};

export type ProjectCounts = {
	name: string;
	tracker: "github" | "linear";
	done: number;
	dropped: number;
	backlog: number;
};

export type Overview = {
	projects: ProjectCounts[];
};

export function ticketState(ticket: Ticket): TicketState {
	if (ticket.state === "open") {
		return "backlog";
	}
	if (
		ticket.stateReason === "not_planned" ||
		ticket.stateReason === "duplicate"
	) {
		return "dropped";
	}
	return "done";
}

export function projectCounts(
	name: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
): ProjectCounts {
	const counts = { done: 0, dropped: 0, backlog: 0 };
	for (const ticket of tickets) {
		counts[ticketState(ticket)] += 1;
	}
	return { name, tracker, ...counts };
}
