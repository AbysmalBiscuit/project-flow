import type { NotificationTrigger, TicketState } from "./domain.ts";

export const stateLabel: Record<TicketState, string> = {
	done: "Done",
	dropped: "Dropped",
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
};

export const blockedLabel = "Blocked";

export const navLabel = {
	projects: "Projects",
	needsYou: "Needs you",
	inbox: "Inbox",
	settings: "Settings",
} as const;

export const triggerLabel: Record<NotificationTrigger, string> = {
	needsYou: navLabel.needsYou,
	comment: "New comment",
	blockerCleared: "Blocker cleared",
};

export const viewLabel = {
	cards: "Cards",
	graph: "Graph",
	table: "Table",
} as const;
