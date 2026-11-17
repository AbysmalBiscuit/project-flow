import type { Queued, RunMessage } from "./domain.ts";

export const runCancelCopy = {
	action: "Cancel run",
	pending: "Cancelling",
	title: "Cancel the run?",
	body: "The factory stops the run and its agents now.",
	dismiss: "Keep running",
	failed: "Cancel failed",
} as const;

export const runRemoveCopy = {
	delete: "Delete",
	deleting: "Deleting",
	archive: "Archive",
	archiving: "Archiving",
	title: "Delete the run?",
	body: "The factory drops the run and its record. The worktree and the branch of the run stay.",
	dismiss: "Keep run",
	archived: "Archived",
} as const;

export const runResumeCopy = {
	action: "Resume",
	pending: "Starting",
	choices: "Resume choices",
	fromCheckpoint: "From checkpoint",
	fromBeginning: "From beginning",
	title: "Restart the run?",
	body: "The factory starts a new run of the ticket from the first stage. The old run stays as it was.",
	bodyBlocked:
		"The factory starts a new run of the ticket from the first stage. The restart cancels the old run.",
	confirm: "Restart run",
	dismiss: "Keep the run",
	resumeFailed: "Resume failed",
	restartFailed: "Restart failed",
} as const;

const labelList = (labels: readonly string[]) =>
	`${labels.length === 1 ? "the label" : "the labels"} ${labels.join(", ")}`;

export const runStartCopy = {
	action: "Start run",
	pending: "Starting",
	requested: "Run requested",
	title: "Start a run?",
	body: (factory: string, label: string) =>
		`Project Flow adds the label ${label} to the ticket. Then the factory ${factory} starts a run of it.`,
	stateBody: (
		factory: string,
		{ state, add, remove }: { state: string; add: string[]; remove: string[] },
	) =>
		[
			`Project Flow moves the ticket to the workflow state ${state}.`,
			...(add.length === 0 ? [] : [`It adds ${labelList(add)}.`]),
			...(remove.length === 0 ? [] : [`It removes ${labelList(remove)}.`]),
			`Then the factory ${factory} starts a run of it.`,
		].join(" "),
	choices: "Run start choices",
	runOn: (factory: string) => `Run on ${factory}`,
	queueOn: (factory: string) => `Queue on ${factory}`,
	runOnBody: (factory: string) =>
		`The factory ${factory} claims the ticket and starts a run of it.`,
	queueOnBody: (factory: string) =>
		`The factory ${factory} claims the ticket and queues a run of it. The run starts when the factory has a free slot.`,
} as const;

export const queuedLabel = "Queued";

/** The tooltip of the Queued chip: the factory, and the label or status that queued the ticket. */
export function queuedTip({ factory, label, status }: Queued): string {
	const reasons = [
		...(label === undefined ? [] : [`label ${label}`]),
		...(status === undefined ? [] : [`status ${status}`]),
	];
	return `Waits for factory ${factory} to start a run: ${reasons.join(" and ")}`;
}

export const runThreadLabel = "Run thread";

/** The verb after the sender of each run thread message. */
export const runMessageLabel = {
	ask: "asks",
	answer: "answers",
	steer: "steers",
} as const satisfies Record<RunMessage["kind"], string>;

export const runFactLabel = {
	status: "Status",
	stage: "Stage",
	ticket: "Ticket",
	openTicket: "Open the ticket",
	verification: "Verification",
	openVerification: "Open the record",
	retro: "Retro",
	openRetro: "Open the retro",
	project: "Project",
	box: "Box",
	factory: "Factory",
	workflow: "Workflow graph",
	start: "Start time",
	elapsed: "Elapsed",
	failureReason: "Failure reason",
	lastEvent: "Last event",
	pr: "PR",
	restartedFrom: "Restarted from",
} as const;

export const openRunLabel = "Open run";

export const runPageLabel = "Run";

export const runMissingLabel = "No factory reports this run.";

export const runReadFailedLabel = "The run did not load.";

export const runEventsLabel = "Run events";

export const noRunEventsLabel = "The run has no events yet.";

/** The note under the run events when their stream ends. */
export const runEventsEndLabel = {
	ended: "The event stream of the run ended.",
	unreachable:
		"The factory stopped answering. Reload the page to read the events again.",
} as const;

/** The columns of the Runs list, in order. */
export const runsColumnLabel = {
	status: runFactLabel.status,
	result: "Result",
	ticket: runFactLabel.ticket,
	project: runFactLabel.project,
	stage: runFactLabel.stage,
	factory: runFactLabel.factory,
	box: runFactLabel.box,
	start: "Start",
	duration: "Duration",
	cost: "Cost",
	pr: runFactLabel.pr,
	actions: "Actions",
} as const;

export const runsListCopy = {
	lead: "Every run that the factories report, newest first",
	search: "Search by ticket key or title",
	allStatuses: "All statuses",
	allResults: "All results",
	allProjects: "All projects",
	allFactories: "All factories",
	empty: "No run matches",
	none: "No factory reports a run",
	status: "Status",
	result: "Result",
	project: "Project",
	factory: "Factory",
	archive: "Archived runs",
	unarchived: "Not archived",
	archivedOnly: "Archived",
	allRuns: "All runs",
} as const;

/** The tabs of the run page, in order. */
export const runTabLabel = {
	overview: "Overview",
	stages: "Stages",
	events: "Events",
	files: "Files changed",
	artifacts: "Artifacts",
	usage: "Usage",
	sandbox: "Sandbox",
	terminal: "Terminal",
	settings: "Settings",
	source: "Source",
} as const;

export type RunTab = keyof typeof runTabLabel;

/** The data that each run page tab shows, for its empty state. */
export const runTabData: Record<RunTab, string> = {
	overview: "the run facts",
	stages: "the run checkpoint",
	events: "the run events",
	files: "the files that the run changed",
	artifacts: "the run artifacts",
	usage: "the run usage",
	sandbox: "the run sandbox",
	terminal: "the run terminal",
	settings: "the run settings",
	source: "the workflow source",
};

export const noRunDataLabel = "No data yet.";

export function notServedLabel(data: string): string {
	return `This factory does not serve ${data}.`;
}

export const runStagesLabel = "Stages";

export const runSandboxLabel = "Run sandbox";

export const sandboxFactLabel = {
	box: "Box",
	host: "Host",
	worktree: "Worktree",
	branch: "Branch",
	head: "Head",
	base: "Base",
	ahead: "Ahead",
	state: "Workspace",
	changes: "Uncommitted changes",
} as const;

export const sandboxStateLabel = {
	none: "No worktree yet",
	removed: "Worktree removed",
	clean: "Clean",
	dirty: "Uncommitted changes",
} as const;

export const noBaseLabel = "No base resolves";

export function aheadLabel(commits: number): string {
	return commits === 1 ? "1 commit" : `${commits} commits`;
}

export const runFilesLabel = "Committed changes";

export const uncommittedChangesLabel = "See the uncommitted changes in";

export const noRunFilesLabel = "No committed file changes since the base.";

export const runFilesGoneLabel =
	"The worktree of the run is gone, so its changed files are not available.";

export const runFileStatusLabel = {
	added: "Added",
	modified: "Modified",
	deleted: "Deleted",
	renamed: "Renamed",
} as const;

export function renamedPathLabel(from: string, to: string): string {
	return `${from} -> ${to}`;
}

export function runFilesCountLabel(count: number): string {
	return count === 1 ? "1 file" : `${count} files`;
}

export const runSettingsLabel = {
	parameters: "Parameters",
	choices: "Agent nodes",
	options: "Run options",
} as const;

export const noParametersLabel = "The workflow declares no parameters.";

export const noChoicesLabel = "The workflow has no agent nodes.";

export const defaultChoiceLabel = "default";

export function choiceModeLabel(mode: string, launcher: string | null): string {
	return launcher === null ? mode : `${mode}, launcher ${launcher}`;
}

export const runOptionLabel = {
	workflow: "Workflow package",
	repo: "Repo",
	ticket: "Ticket",
	author: "Author",
	keepWorktree: "Keep worktree",
	sent: "Sent by the hub",
	source: "Hub feed",
	rule: "Dispatch rule",
} as const;

export const yesNoLabel = { true: "Yes", false: "No" } as const;

export const runSourceLabel = "Workflow source";

export const entryGraphLabel = "Entry graph";

export const calledGraphFileLabel = "Called graph";

export const runArtifactsLabel = "Run artifacts";

export const noRunArtifactsLabel = "The run has no artifacts yet.";

export const artifactMissingLabel = "The factory did not give this artifact.";

export const artifactBinaryLabel =
	"This artifact is not text, so the page does not show it.";

const fileSize = new Intl.NumberFormat("en", {
	notation: "compact",
	style: "unit",
	unit: "byte",
	unitDisplay: "narrow",
});

export function artifactSizeLabel(bytes: number): string {
	return fileSize.format(bytes);
}

export const currentStageLabel = "Current";

export const runGraphLabel = "Workflow";

export const runGraphHelp =
	"Each stage has the shape of its workflow node. Drag to pan and scroll to zoom. Hover a stage to light its chain. Click a stage to open its details, or its arrow to open its subgraph. Double-click or Shift-click a stage to focus its chain. Escape clears the focus, then closes the details.";

export const runStageStateLabel = {
	current: "Current",
	completed: "Completed",
	ahead: "Ahead",
	failed: "Failed",
} as const;

const stageKindLabels: Record<string, string> = {
	start: "Start",
	exit: "Exit",
	codergen: "Agent",
	"wait.human": "Human",
	conditional: "Conditional",
	parallel: "Parallel",
	"parallel.fan_in": "Fan-in",
	tool: "Command",
	"stack.manager_loop": "Manager loop",
};

/** The kind of a workflow stage, from the workcell handler that it runs. */
export function stageKindLabel(kind: string): string {
	return stageKindLabels[kind] ?? kind;
}

export const runGraphLegendLabel = {
	legend: "Workflow legend",
	states: "Stage states",
	shapes: "Stage shapes",
	edge: "An edge with its condition or label",
	edgeSample: "outcome=success",
	calledGraph:
		"A frame holds the stages that the run reached in the graph that a stage calls",
	roles: "Stage roles",
	noRole: "no role",
	calledGraphDiagram:
		"A frame holds the stages of the graph that a stage calls",
	opensGraph:
		"The arrow button on a stage opens the subgraph that the stage calls",
} as const;

export function calledGraphLabel(open: boolean, stage: string): string {
	return `${open ? "Close" : "Open"} the graph that ${stage} calls`;
}

export const openGraphLabel = (graph: string): string => `Open ${graph}`;
export const callsGraphLabel = (graph: string): string => `Calls ${graph}`;
export const openSubgraphLabel = (graph: string): string =>
	`Open the subgraph ${graph}`;

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

export const compactCount = new Intl.NumberFormat("en", {
	notation: "compact",
});

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

export const stageTranscriptLabel = "Stage transcript";

export const stageTranscriptData = "the stage transcript";

export const noTranscriptLabel =
	"The agent of this stage has recorded nothing yet.";

export const runContextLabel = "Run context";

export const runContextData = "the run context";

export const runContextHelp =
	"The context values of the run now. All stages of a run share them.";

export const toolCallLabel = (name: string, truncated: boolean): string =>
	truncated ? `${name} (input cut)` : name;

export const steerEntryLabel = (sender: string, interrupt: boolean): string =>
	interrupt ? `Steer from ${sender}, with interrupt` : `Steer from ${sender}`;

export const stagePaneLabel = "Stage pane";

export const terminalStageLabel = "Stage";

export const terminalEndedLabel = "The stage has ended.";

export const noTerminalStageLabel = "The run has reached no stage yet.";

export const closeStagePaneLabel = "Close the stage pane";

export const openInStagesLabel = "Open in Stages";

export const childStagesLabel = (label: string): string => `Stages of ${label}`;
