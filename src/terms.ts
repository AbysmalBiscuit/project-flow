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
	ask: "Question",
	awaitingMerge: "Ready to merge",
	label: "Labeled for you",
	runFailed: "Run failed",
};

export const answeredReason = "Answered, clearing";

export const reasonTab: Record<NeedsYouItem["reason"], string> = {
	ask: "Questions",
	awaitingMerge: "Merges",
	label: "Labels",
	runFailed: "Runs",
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

export function actionLabel(
	item: NeedsYouItem,
	surface: "row" | "strip" = "row",
): string {
	if (item.reason === "ask") {
		if (surface === "strip") {
			return "Answer question";
		}
		return item.answered ? "View" : "Answer";
	}
	if (item.reason === "awaitingMerge") {
		return "Merge";
	}
	if (item.reason === "label") {
		return "Open ticket";
	}
	return "View";
}

export function polledAgo(fetchedAt: string | null): string | null {
	if (fetchedAt === null) {
		return null;
	}
	const then = Date.parse(fetchedAt);
	if (Number.isNaN(then)) {
		return null;
	}
	const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (seconds < 60) {
		return `polled ${seconds} s ago`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `polled ${minutes} min ago`;
	}
	return `polled ${Math.round(minutes / 60)} h ago`;
}
