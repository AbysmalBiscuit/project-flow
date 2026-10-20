import type {
	NeedsYouItem,
	NotificationTrigger,
	TicketState,
} from "./domain.ts";

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
	logo: "Project Flow",
	overview: "Overview",
	projects: "Projects",
	needsYou: "Needs you",
	inbox: "Inbox",
	settings: "Settings",
	theme: "Theme",
	light: "Light",
	dark: "Dark",
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

export const reasonLabel: Record<NeedsYouItem["reason"], string> = {
	ask: "Ask",
	awaitingMerge: "Awaiting merge",
	label: "Label",
	runFailed: "Run failed",
};

export const reasonOrder: readonly NeedsYouItem["reason"][] = [
	"ask",
	"awaitingMerge",
	"label",
	"runFailed",
];

export const needsGroupLabel = {
	project: "Project",
	reason: "Reason",
	none: "None",
} as const;

export type NeedsGroup = keyof typeof needsGroupLabel;

export const overviewFilterLabel = {
	all: "All projects",
	"needs-you": "Needs you",
	blocked: "Blocked",
	pinned: "Pinned",
} as const;

export const overviewSortLabel = {
	name: "Name",
	progress: "Progress",
	"needs-you": "Needs you",
	blockers: "Cross-project blockers",
} as const;

export const overviewControlLabel = {
	pinned: "Pinned",
	filter: "Filter",
	sort: "Sort",
	search: "Search projects",
	needsYouFirst: "Needs you first",
	polled: "polled",
	unlinked: "unlinked PR",
} as const;
