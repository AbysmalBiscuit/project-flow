import type { TicketState } from "./domain.ts";

export function sameTicketKey(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

export type TicketRef = {
	tracker: "github" | "linear";
	project: string;
	key: string;
};

export function sameTicket(left: TicketRef, right: TicketRef): boolean {
	return (
		left.tracker === right.tracker &&
		left.project === right.project &&
		sameTicketKey(left.key, right.key)
	);
}

export type TicketSearchHit = TicketRef & {
	title: string;
	state: TicketState;
};
