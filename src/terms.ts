import type {
	NeedsYouItem,
	NotificationTrigger,
	RunStatusKind,
	ShownFactoryRun,
	TicketState,
} from "./domain.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import type { GraphDirection } from "./view-settings.ts";

export const stateLabel: Record<TicketState, string> = {
	done: "Done",
	dropped: "Dropped",
	backlog: "Backlog",
	inProgress: "In progress",
	inReview: "In review",
	awaitingMerge: "Awaiting merge",
};

export const runStatusLabel: Record<RunStatusKind, string> = {
	queued: "Queued",
	starting: "Starting",
	running: "Running",
	blocked: "Blocked",
	failed: "Failed",
	succeeded: "Succeeded",
};

/** The hover text of a card's run circle, for example "Running, stage 3, on box-a, 12 min, from work hub". */
export function factoryRunTip(
	run: ShownFactoryRun,
	elapsed: string | null,
): string {
	return [
		runStatusLabel[run.statusKind],
		run.stage,
		run.box === null ? "in the hub queue" : `on ${run.box}`,
		elapsed,
		`from ${run.factory}`,
	]
		.filter((part) => part !== undefined && part !== null)
		.join(", ");
}

/** The state of an open outside parent ticket whose lane is unknown. */
export const openParentLabel = "Open";

export const projectPageLabel = "Project page";

export function factoryTokenFallbackLabel(report: FactoryTokenReport): string {
	if (report.cause === "mint failed") {
		const status =
			report.status === "missing"
				? "could not start"
				: `exited with status ${report.status}`;
		const detail = report.detail === undefined ? "" : `: ${report.detail}`;
		return `The factory token mint ${report.command} ${status}${detail}. Reads use your token.`;
	}
	if (report.cause === "no installation") {
		return `${report.owner} reads use your token: the factory App has no installation for this owner.`;
	}
	return `${report.owner} reads use your token: the factory token file ${report.path} is ${report.cause}.`;
}

export function parentChipLabel(key: string): string {
	return `Parent ${key}`;
}

export function subTicketsLabel(count: number): string {
	return `${count} ${count === 1 ? "sub-ticket" : "sub-tickets"}`;
}

export function subTicketsDoneLabel(done: number, total: number): string {
	return `${done}/${total} done`;
}

export function subTicketsToggleLabel(key: string, collapsed: boolean): string {
	return `${collapsed ? "Expand" : "Collapse"} the sub-tickets of ${key}`;
}

export const frameToolLabel = {
	expandAll: "Expand all",
	collapseAll: "Collapse all",
} as const;

export const graphScopeLabel = {
	nav: "Graph scope",
	focus: "Focus",
} as const;

export function openFramesLabel(count: number): string {
	if (count === 0) {
		return "No frames open";
	}
	return `${count} ${count === 1 ? "frame" : "frames"} open`;
}

export const loadingLabel = "Loading";

export const navLabel = {
	logo: "Project Flow",
	overview: "Overview",
	projects: "Projects",
	needsYou: "Needs you",
	inbox: "Inbox",
	refreshing: "Refreshing",
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
	board: "Board",
	graph: "Graph",
	table: "Table",
	lastUsed: "Last used view",
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

export const threadMissingLabel = "This thread could not be read.";

export const threadFailedLabel = "This thread did not load.";

export const graphLayoutFailedLabel = "The graph did not lay out.";

export const threadRetryLabel = "Retry";

export const expandPanelLabel = "Expand panel";

export const collapsePanelLabel = "Collapse panel";

export const closePanelLabel = "Close";

export const openOnGitHubLabel = "Open on GitHub";

export const pullButtonLabel = "PR";

export const openPullLabel = "Open the PR on GitHub";

export const runSectionLabel = "Factory run";

export const runNotLiveLabel = "Not live: the factory is unreachable";

export const earlierRunsLabel = "Earlier runs";

export const runQuestionsLabel = "Run questions";

export const steerLabel = "Steer the run";

export const runFactLabel = {
	status: "Status",
	stage: "Stage",
	box: "Box",
	factory: "Factory",
	start: "Start time",
	elapsed: "Elapsed",
	pr: "PR",
} as const;

export const runStagesLabel = "Stages";

export const currentStageLabel = "Current";

export function stageVisitsLabel(visits: number): string {
	return `${visits} ${visits === 1 ? "visit" : "visits"}`;
}

export function stageRetriesLabel(retries: number): string {
	return `${retries} ${retries === 1 ? "retry" : "retries"}`;
}

export const runUsageLabel = "Run usage";

export const usageFactLabel = {
	tokens: "Tokens",
	cost: "Cost",
	time: "Time",
	tools: "Tools",
} as const;

const compactCount = new Intl.NumberFormat("en", { notation: "compact" });

export function tokensLabel(input: number, output: number): string {
	return `${compactCount.format(input)} in, ${compactCount.format(output)} out`;
}

export function costLabel(costUsd: number): string {
	return `$${costUsd.toFixed(2)}`;
}

export const usagePartSeparator = "; ";

/** The count of each tool, most used first. */
export function toolCountsLabel(tools: Record<string, number>): string {
	return Object.entries(tools)
		.sort(([, left], [, right]) => right - left)
		.map(([tool, count]) => `${tool} ${count}`)
		.join(", ");
}

export const runAgentsLabel = "Agents";

export const agentTurnLabel = {
	running: "Turn runs",
	ended: "Turn ended",
} as const;

export function agentToolLabel(tool: string): string {
	return `Uses ${tool}`;
}

export const hubQueueLabel = "In the hub queue";

export const noStartLabel = "No start time";

export const mergeFactLabel = {
	pr: "PR",
	ci: "CI",
	review: "Review",
} as const;

export const heldActionLabel = {
	merge: "Merge",
	removeLabel: "Remove label",
} as const;

export const pullStatusLabel = {
	ci: {
		passing: "Passing",
		failing: "Failing",
		pending: "Pending",
		none: "None",
	},
	review: {
		approved: "Approved",
		changes: "Changes requested",
		completed: "Completed",
		pending: "Pending",
		none: "None",
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
	filter: "Filter",
	sort: "Sort",
	search: "Search projects",
	needsYouFirst: "Needs you first",
	refresh: "Refresh",
	refreshing: "Refreshing",
	reading: "Reading",
	pollProgress: "of",
	updated: "updated",
	updating: "updating",
	projects: "projects",
	tickets: "tickets",
	unlinked: "unlinked PR",
	moreBlockers: "more",
	zoomIn: "Zoom in",
	zoomOut: "Zoom out",
	fit: "Fit",
	needsYouOne: "1 needs you",
	needsYouMany: "need you",
	edgeCaption:
		"An arrow runs from a blocking project to the project it blocks. Its label is the blocking ticket; click it to open that ticket. Projects with a dark border need you.",
	noneTracked: "No tracked project",
	noneTrackedHint: "Turn a project on in",
} as const;

export const graphDirectionLabel: Record<GraphDirection, string> = {
	"left-to-right": "Left to right",
	"top-to-bottom": "Top to bottom",
};

export const graphLayoutLabel = {
	layered: "Layered",
	force: "Force",
} as const;

export const graphLayoutTip = {
	layered: "Lines up the tickets in ranks along the blocker arrows.",
	force: "Pulls linked tickets together and pushes the rest apart.",
} as const;

export const groupByLabel = {
	workstream: "Workstream",
	theme: "Theme",
	assignee: "Assignee",
	none: "None",
} as const;

export const hidingFilterIds = [
	"lanes",
	"maxAge",
	"needsYouOnly",
	"blockedOnly",
	"assignees",
	"search",
] as const;

export type HidingFilter = (typeof hidingFilterIds)[number];

export const hidingFilterLabel: Record<HidingFilter, string> = {
	lanes: "Lanes",
	maxAge: "Max age",
	needsYouOnly: "Needs you only",
	blockedOnly: "Blocked only",
	assignees: "Assignees",
	search: "Search",
};

export const clearFocusLabel = "Clear focus";

export const filterEmptyLabel = {
	clear: "Clear filters",
	one: "hides",
	many: "hide",
	every: "every ticket.",
} as const;

export const projectGraphLabel = {
	legend: "Graph legend",
	arrow: "Arrow: blocker to blocked",
	done: "Dashed: done blocker",
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

export const settingsSection = {
	general: "General",
	views: "Project views",
	states: "States",
	projects: "Projects",
	review: "Review",
	notifications: "Notifications",
	trackers: "Trackers",
	factories: "Factories",
} as const;

export const factoryCopy = {
	lead: "Project Flow reads workcell runs from each factory. A hub covers the runs of its boxes.",
	flagLead:
		"This launch reads the --factory list. The configured list applies on a launch without --factory.",
	none: "No factory set.",
	name: "Factory name",
	url: "http, https or unix URL",
	reachable: "Reachable",
	unreachable: "Unreachable",
	unchecked: "Not checked",
	notRead: "Not read in this launch",
	flag: "--factory",
	config: "Configuration",
	hub: "Hub",
	daemon: "Standalone",
	headerMarker: "factory unreachable",
} as const;

export function alsoReadThroughHub(hub: string): string {
	return `also read through hub ${hub}; remove one`;
}

export function boxCount(boxes: number): string {
	return boxes === 1 ? "1 box" : `${boxes} boxes`;
}

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
	pollInterval: "Poll interval",
	pollHint: "How often each tracker is read.",
	factoryTokens: "Factory GitHub tokens",
	factoryTokensHint:
		"GitHub reads and polls use the factory token for that repo owner. Replies stay on your token.",
	viewsLead:
		"The board, graph and table views save these to the configuration file when you change them there.",
	openIn: "Open projects in",
	openHint: "The view a project page opens in.",
	graphDirection: "Graph direction",
	graphHint: "Which way the dependency graph runs.",
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
	savedToast: "Settings saved",
	ask: "Ask",
	yes: "Yes",
	no: "No",
	mappingKey: "Team or project",
	statusName: "Status name",
	repo: "Repo",
	projectsLead:
		"Project Flow polls only tracked projects, and only tracked projects show on the overview. Expected review bots must review a PR before it counts as reviewed. PM Bot reviews and answers the run's questions for this project.",
	searchProjects: "Search projects",
	filter: "Filter",
	tracker: "Tracker",
	state: "State",
	all: "All",
	tracked: "Tracked",
	project: "Project",
	pmBot: "PM Bot",
	expectedBots: "Expected review bots",
	addBot: "Add bot",
	botsUnavailable: "No repository known",
	of: "of",
	projects: "projects",
	statesLead:
		"The board shows one lane per state, in this order. Each state shows in its colour on the board, cards, graphs and side panel, in both themes. The categories set which tickets a state holds when no mapping names it.",
	stateName: "State name",
	newState: "New state",
	addState: "Add state",
	moveUp: "Up",
	moveDown: "Down",
	remove: "Remove",
	moveTicketsTo: "Move tickets to",
	stateMappings: "State mapping",
	stateMappingsLead:
		"Map each tracker status or label of a board to a state. A status with no mapping goes to the first state of its category.",
	byCategory: "By category",
	mapsTo: "maps to",
	label: "Label",
	mapLabel: "Map a label",
	colour: "colour",
	saturation: "Saturation",
	brightness: "brightness",
	hue: "Hue",
	hex: "Hex",
	reset: "Reset",
	resetTitle: "Reset the states?",
	resetBody:
		"The states and mappings go back to the defaults. The app saves the defaults at once.",
	resetConfirm: "Reset states",
	cancel: "Cancel",
} as const;
