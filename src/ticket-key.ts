export function sameTicketKey(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

export type TicketSearchHit = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	title: string;
	state:
		| "done"
		| "dropped"
		| "backlog"
		| "inProgress"
		| "inReview"
		| "awaitingMerge";
};
