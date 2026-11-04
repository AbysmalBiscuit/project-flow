/** The copy of the Settings page and its factory list. */

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
	readyLabel: "Start and queue label (optional)",
	readyLabelOf: (label: string) => `start and queue label ${label}`,
	readyStatusOf: (status: string) => `queue status ${status}`,
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
	showNeedsYou: "Show Needs you on the overview",
	showNeedsYouHint:
		"The overview lists the first tickets that wait for you above the projects.",
	pollInterval: "Poll interval",
	pollHint: "How often each tracker is read.",
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
	connected: "Connected",
	missing: "Missing",
	discard: "Discard",
	save: "Save",
	savingToast: "Saving settings...",
	savedToast: "Settings saved",
	ask: "Ask",
	yes: "Yes",
	no: "No",
	mappingKey: "Team or project",
	statusName: "Status name",
	repo: "Repo",
	projectsLead:
		"Project Flow polls only tracked projects, and only tracked projects show on the overview. Pinned projects show first on the overview. Expected review bots must review a PR before it counts as reviewed. PM Bot reviews and answers the run's questions for this project.",
	searchProjects: "Search projects",
	filter: "Filter",
	tracker: "Tracker",
	state: "State",
	all: "All",
	tracked: "Tracked",
	pinned: "Pinned",
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
