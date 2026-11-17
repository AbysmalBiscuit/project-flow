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
	openingTitle: "Opening a project",
	defaultFiltersTitle: "Default filters",
	defaultFiltersLead:
		"A project page starts with these filters. When you change a filter on a project page, that project keeps its own filters from then on.",
	shownColumn: "Show",
	ageColumn: "Hide tickets older than",
	openIn: "Open projects in",
	openHint: "The view a project page opens in.",
	graphDirection: "Graph direction",
	graphHint: "Which way the dependency graph runs.",
	anyAge: "No limit",
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
	addLabel: "Add label",
	addLogin: "Add login",
	laneState: "Lane state",
	browserPermission: "Browser permission",
	browserHint: "The browser decides if Project Flow may show notifications.",
	allowed: "Allowed",
	blocked: "Blocked",
	asking: "Not asked",
	trackersLead:
		"Project Flow never stores a token. It reads each token once at the start, from the environment or from Doppler.",
	nextStart: "A change to where a token comes from applies at the next start.",
	tokenFrom: { environment: "Environment", doppler: "Doppler" },
	tokenFromOf: (tracker: string) => `Read the ${tracker} token from`,
	fromDoppler: ({
		project,
		config,
		secret,
	}: {
		project: string;
		config: string;
		secret: string;
	}) =>
		`Token from Doppler secret ${secret || "?"} in ${project || "?"}/${config || "?"}`,
	dopplerField: {
		project: "Doppler project",
		config: "Config",
		secret: "Secret name",
	},
	connected: "Connected",
	missing: "Missing",
	discard: "Discard",
	unsaved: "Unsaved changes in",
	unsavedMark: "unsaved changes",
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
	trackOnlyHint: "Track the project to set its bots.",
	projects: "projects",
	statesLead:
		"The board shows one lane per state, in this order. Each state shows in its colour on the board, cards, graphs and side panel, in both themes. Each state can hold some kinds of work automatically, such as started or finished work.",
	stateName: "State name",
	newState: "New state",
	addState: "Add state",
	moveUp: "Move up",
	moveDown: "Move down",
	holdsColumn: "Holds automatically",
	holdsNothing: "Nothing",
	holdsOf: (state: string) => `What ${state} holds automatically`,
	holdsLead:
		"A ticket whose status has no state mapping goes to the first state, from the top, that holds the kind of work its status means.",
	heldAbove: (state: string) =>
		`${state} is higher in the list and also holds these tickets, so they go there.`,
	categoryHint: {
		backlog: "Planned work that nobody has started.",
		inProgress: "Work that someone has started.",
		inReview: "A PR that waits for review.",
		awaitingMerge: "A reviewed PR that waits to merge.",
		done: "Finished work.",
		dropped: "Work closed without finishing it.",
	},
	remove: "Remove",
	moveTicketsTo: "Move tickets to",
	stateMappings: "State mapping",
	mappedCount: (mapped: number) => `${mapped} mapped`,
	mapStates: "Map states",
	noBots: "None",
	reviewBotsOf: (project: string) => `Review bots of ${project}`,
	reviewBotsLead:
		"A PR counts as reviewed after each bot of its repo reviews it. Each repo where this project's PRs land keeps its own list. Every project with PRs in that repo shares the list.",
	mapStatesOf: (project: string) => `Map states of ${project}`,
	sharedBoard: (projects: readonly string[]) =>
		`The mapping also applies to ${projects.join(", ")}, which share this board.`,
	trackerStatus: "Tracker status",
	noStatuses:
		"This board has no tracker statuses. Map a label to place its tickets in a state.",
	done: "Done",
	notPolled: "Not read yet",
	tokenFallbacks: (owners: number) =>
		owners === 1
			? "1 owner reads with your token"
			: `${owners} owners read with your token`,
	stateMappingsLead:
		"Map each tracker status or label of a board to a state. A status with no mapping goes to the first state of its category.",
	automatic: (state: string | undefined) => `Automatic: ${state ?? "no state"}`,
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
