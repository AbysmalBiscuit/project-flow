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

export const inboxFilterLabel: Record<NotificationTrigger, string> = {
	needsYou: navLabel.needsYou,
	comment: "Comments",
	blockerCleared: "Blockers cleared",
};

export const inboxCopy = {
	lead: "Notifications this app sent, newest first",
	unread: "unread",
	unreadOnly: "Unread only",
	markAll: "Mark all read",
	banner:
		"Browser notifications are off. The Inbox still collects every entry.",
	denied:
		"Browser notifications are blocked. Allow them in the browser settings. The Inbox still collects every entry.",
	allow: "Allow notifications",
	dismiss: "Dismiss",
	today: "Today",
	yesterday: "Yesterday",
	earlier: "Earlier",
	empty: "No notifications",
} as const;

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

export const whyLabel = "Why this needs you";

export const heldActionLabel = {
	merge: "Merge",
	removeLabel: "Remove label",
} as const;

export const pullStatusLabel = {
	ci: {
		passing: "CI passing",
		failing: "CI failing",
		pending: "CI pending",
		none: "CI none",
	},
	review: {
		approved: "Review approved",
		changes: "Review changes",
		completed: "Review completed",
		pending: "Review pending",
		none: "Review none",
	},
} as const;

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
	project: "Project",
	tracker: "Tracker",
	progress: "Progress",
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
	needsYou: "Needs you",
	blockedBy: "Blocked by",
} as const;

export const trackerLabel = {
	github: "GitHub",
	linear: "Linear",
} as const;

export const tableColumnLabel = {
	project: "Project",
	tracker: "Tracker",
	progress: "Progress",
	backlog: stateLabel.backlog,
	inProgress: stateLabel.inProgress,
	inReview: stateLabel.inReview,
	awaitingMerge: stateLabel.awaitingMerge,
	needsYou: navLabel.needsYou,
	blockedBy: "Blocked by",
} as const;

export const overviewControlLabel = {
	pinned: "Pinned",
	filter: "Filter",
	sort: "Sort",
	search: "Search projects",
	needsYouFirst: "Needs you first",
	polled: "polled",
	projects: "projects",
	tickets: "tickets",
	unlinked: "unlinked PR",
	zoomIn: "Zoom in",
	zoomOut: "Zoom out",
	fit: "Fit",
	needsYouOne: "1 needs you",
	needsYouMany: "need you",
	edgeCaption:
		"An arrow runs from a blocking project to the project it blocks. Its label is the blocking ticket; click it to open that ticket. Projects with a dark border need you.",
} as const;

export const graphDirectionLabel = {
	"left-to-right": "Left to right",
	"top-to-bottom": "Top to bottom",
} as const;

export const projectGraphLabel = {
	legend: "Graph legend",
	ready: "Ready",
	arrow: "Arrow: blocker to blocked",
	dashed: "Dashed: ticket in another project",
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

export const settingsSection = {
	general: "General",
	views: "Project views",
	review: "Review",
	notifications: "Notifications",
	trackers: "Trackers",
} as const;

export const settingsCopy = {
	savedTo: "Saved to the configuration file. Changes apply without a restart.",

	newComment: "New comment",
	newCommentHint: "Someone else comments on a ticket or a linked PR.",
	blockerCleared: "Blocker cleared",
	blockerClearedHint: "The last open blocker of a ticket closes.",
	needsYouHint: "A ticket asks for you, or a PR waits for your merge.",
	theme: "Theme",
	themeHint:
		"The theme button in the header switches light and dark. The app writes the choice to the configuration file at once, and starts in it next time.",
	activityWindow: "Activity window",
	activityHint: "Show projects with ticket activity in this many days.",
	days: "days",
	pollInterval: "Poll interval",
	pollHint: "How often each tracker is read.",
	viewsLead:
		"The board, graph and table views save these to the configuration file when you change them there.",
	openBoard: "Lane",
	openGraph: "Graph",
	openTable: "Table",
	openIn: "Open projects in",
	openHint: "The view a project page opens in.",
	graphDirection: "Graph direction",
	graphHint: "Which way the dependency graph runs.",
	leftToRight: "Left to right",
	topToBottom: "Top to bottom",
	ticketFilter: "Ticket filter",
	ticketHint:
		"The states the views show, and the oldest ticket each state keeps.",
	anyAge: "Any age",
	needsYouOnly: "Needs you only",
	needsYouOnlyHint: "Show only tickets that wait for you.",
	blockedOnly: "Blocked only",
	blockedOnlyHint: "Show only tickets with an open blocker.",
	laneMappings: "Lane mapping",
	laneHint:
		"Map a state to a tracker status name for one Linear team or GitHub project.",
	autoMerge: "Auto-merge",
	autoMergeHint:
		"Override the reading for one repo. Ask keeps a finished review in Awaiting merge.",
	labels: "Needs-you labels",
	labelsHint: "A ticket with one of these labels shows in Needs you.",
	logins: "Your logins",
	loginsHint: "Comments from these accounts never notify you.",
	add: "Add",
	addLabel: "Add label, press Enter",
	addLogin: "Add login, press Enter",
	laneState: "Lane state",
	browserPermission: "Browser permission",
	browserHint: "The browser decides if Project Flow may show notifications.",
	allowed: "Allowed",
	blocked: "Blocked",
	asking: "Not asked",
	trackersLead: "Project Flow never stores a token.",
	github: "GitHub",
	githubHint: "Token from gh auth token",
	linear: "Linear",
	linearHint: "LINEAR_API_KEY found in the environment",
	connected: "Connected",
	missing: "Missing",
	discard: "Discard",
	save: "Save",
	saved: "Saved",
	ask: "Ask",
	yes: "Yes",
	no: "No",
	mappingKey: "Team or project",
	statusName: "Status name",
	repo: "Repo",
} as const;
