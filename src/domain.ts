import { z } from "zod";

import type { Configuration, ProjectPin } from "./configuration.ts";
import type { KnownBot } from "./known-bots.ts";
import type { ProjectRef } from "./project-ref.ts";
import type { HidingFilter } from "./terms.ts";
import type { GroupBy } from "./view-settings.ts";

export const trackers = ["github", "linear"] as const;

export type Tracker = (typeof trackers)[number];

export type WorkcellRun = {
	key: string;
	status: "running" | "failed";
	repo?: string;
};

export type LiveRun = {
	status: "running" | "failed";
	stage?: string;
};

export const runStatusKinds = [
	"queued",
	"starting",
	"running",
	"blocked",
	"failed",
	"succeeded",
] as const;

export type RunStatusKind = (typeof runStatusKinds)[number];

/** An open question that a blocked run waits on, from `GET /runs/{id}/questions`. */
export type FactoryQuestion = { id: string; text: string };

/** One message of a run thread: an ask of the run, an answer to an ask, or a delivered steer. */
export type RunMessage = {
	kind: "ask" | "answer" | "steer";
	/** The stage that asks, or the person who answers or steers. */
	sender: string;
	text: string;
	/** The time of the message as an ISO string. */
	at: string;
};

/** A workcell run that a factory reports in `GET /runs`. */
export type FactoryRun = {
	id: string;
	key: string;
	repo?: string;
	statusKind: RunStatusKind;
	/** The box that does the run. Null while the run waits in the hub queue. */
	box: string | null;
	factory: string;
	/** The hub source that started the run. */
	source?: string;
	/** The hub rule that started the run. */
	rule?: string;
	submittedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	/** False when the factory did not answer its last read. */
	coveredByFeed: boolean;
	/** True when the factory serves an event stream, which gives the stage. */
	streamed: boolean;
	/** The path of the run's current node, from the event stream. */
	stage?: string;
	/** The open questions of a blocked run. Absent when the factory gave no list. */
	questions?: FactoryQuestion[];
	/** The asks, answers and delivered steers of the run, oldest first. Absent until the run has one. */
	thread?: RunMessage[];
	/** Why the run failed, as the factory gives it. */
	failureReason?: string;
	/** The PR that the run opened, from `GET /runs/{id}`. Absent until the factory names one. */
	pull?: RunPull;
	/** The id of the run that this run restarted. */
	restartedFrom?: string;
	/** The sums of the run's agent turns, from `GET /runs`. Absent when the factory gives none. */
	usageTotals?: UsageTotals;
};

/** The PR that a run opened, as the factory gives it from the run's `pr_url` output. */
export type RunPull = {
	repo: string;
	number: number;
	url: string;
	/** True when the run recorded the merge of its PR. */
	merged: boolean;
};

/** What the work of an ended run came to. A live or queued run has no result yet. */
export const runResults = [
	"merged",
	"prOpen",
	"noPr",
	"failed",
	"cancelled",
] as const;

export type RunResult = (typeof runResults)[number];

/** The last box event of a run that the event stream gave. */
export type RunEvent = {
	event: string;
	/** The node path that the event names. */
	stage: string;
	/** The time that the box recorded the event, as an ISO string. */
	at?: string;
};

/** One event of the Events tab: a box event of a run, with the id that the factory gives it. */
export type RunLogEvent = Required<RunEvent> & { id: string; data: unknown };

/**
 * Why the event stream of a run ended: the run ended, the factory does not serve
 * the route, or the factory stopped answering.
 */
export type RunEventsEnd = { reason: "ended" | "not served" | "unreachable" };

/** A file that a run stage wrote in its stage folder, or a value that it added to the artifact store. */
export type RunArtifact = {
	/** The path of the stage folder in the run folder, such as `implement@v1.a1`. One stage has one folder for each visit. */
	folder: string;
	/** The path of the stage through the child graphs, such as `review/verdict`. */
	stage: string;
	/** The path of the file in the stage folder, such as `response.md`. */
	name: string;
	/** The media type. */
	type: string;
	/** The size in bytes. */
	size: number;
};

/** One run artifact with its content: text for `utf-8`, and base64 for any other file. */
export type RunArtifactContent = RunArtifact & {
	encoding: "utf-8" | "base64";
	content: string;
};

/** Where a run does its work: the machine, the worktree and its git state. */
export type RunSandbox = {
	/** The hostname of the machine that runs the run. */
	host: string;
	/** Null before the run sets up a worktree. */
	worktree: string | null;
	branch: string | null;
	/** The commit of the worktree. */
	head: string | null;
	/** The base branch of the run's PR. Null when no base resolves. */
	base: string | null;
	/** The commits on the branch that the remote base lacks. Null when no base resolves. */
	ahead: number | null;
	/** `none` before the run sets up a worktree, and `removed` after the worktree is gone. */
	state: "none" | "removed" | "clean" | "dirty";
	/** Each `git status --porcelain` line of the worktree. */
	changes: string[];
};

/** A file that a run's branch changed since it left its base, as a GitHub pull request shows it. */
export type RunFile = {
	path: string;
	/** The path before a rename. */
	previousPath?: string;
	status: "added" | "modified" | "deleted" | "renamed";
	/** A binary file counts no lines. */
	additions: number;
	deletions: number;
	/** The `git diff` of the file. */
	patch: string;
};

/** The graph files that a run loaded from its package, as the run loaded them. */
export type RunSource = {
	/** The path of the entry graph in the package, such as `pre_pr.dot`. */
	entry: string;
	/** The entry graph first, then each child graph that it calls, by its path in the package. */
	graphs: { path: string; text: string }[];
};

/** A workcell run with the facts that its run page shows. */
export type RunDetail = FactoryRun & {
	/** The name of the run's workflow graph. */
	workflow?: string;
	lastEvent?: RunEvent;
};

/**
 * The newest factory run of a ticket. The stage comes from the event stream,
 * or from the progress comment when the factory serves no event stream.
 */
export type ShownFactoryRun = Pick<
	FactoryRun,
	| "id"
	| "statusKind"
	| "box"
	| "factory"
	| "source"
	| "rule"
	| "startedAt"
	| "endedAt"
	| "coveredByFeed"
	| "questions"
	| "thread"
> & { stage?: string; result?: RunResult };

/** Where a factory run is in its flow, from the run checkpoint of its box. */
export type RunCheckpoint = {
	/** The path of the current stage. Null when the run is at no stage. */
	stage: string | null;
	/** The stages that the run finished, in order. */
	completedStages: string[];
	/** The retries of each stage, by stage name. */
	retries: Record<string, number>;
	/** The visits of each stage, by stage name. A review stage visit is one review round. */
	visits: Record<string, number>;
	/** The usage of the run's recorded turns. Absent when the factory gave no turns. */
	usage?: RunUsage;
	/** True when the factory answers the turns read with 404. */
	usageNotServed?: true;
	/** The run's workflow graph with the state of each stage. Null when the factory serves no graph. */
	graph: RunGraph | null;
};

/** The usage of some agent turns: tokens, cost in US dollars, time in seconds, and the count of each tool. */
export type TurnUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	durationS: number;
	tools: Record<string, number>;
};

/** The tokens, cost and time of some agent turns, without the tool counts. */
export type UsageTotals = Omit<TurnUsage, "tools">;

/** The usage of each stage of a run, by stage name, and their sum. */
export type RunUsage = {
	stages: Record<string, TurnUsage>;
	total: TurnUsage;
};

/** The run statuses of a run that has ended. Lev can cancel or steer a run in any other status. */
export const endedRunStatusKinds = [
	"failed",
	"succeeded",
] as const satisfies readonly RunStatusKind[];

/** The run statuses whose agents can work: the app reads a run's agents only in these. */
export const liveRunStatusKinds = [
	"starting",
	"running",
	"blocked",
] as const satisfies readonly RunStatusKind[];

/** What the agent of one stage of a live run does now, from `GET /runs/{id}/workers`. */
export type RunAgent = {
	/** The node path of the stage that the agent works on. */
	stage: string;
	/** The tool that the agent uses now. Null between tool calls and after its turn. */
	tool: string | null;
	/** The last line of the agent's last message. Null before its first message. */
	lastMessage: string | null;
	turn: "running" | "ended";
};

/**
 * Where a stage of a run's workflow graph is: the current stage, a completed
 * stage, a stage ahead, or the stage where the run failed.
 */
export type RunGraphNodeState = "current" | "completed" | "ahead" | "failed";

/** One stage of a run's workflow graph. A stage of a child graph has the path `caller/stage` as its id. */
export type RunStage = {
	id: string;
	label: string;
	state: RunGraphNodeState;
	visits: number;
	retries: number;
};

export type RunGraphNode = RunStage & {
	/** The Graphviz shape of the workflow node. */
	shape: string;
	/** The workcell handler that the node runs, such as `codergen` or `wait.human`. */
	kind: string;
	/**
	 * The child graph that the stage calls. The factory serves only the entry
	 * graph, so the stages are those that the run reached in its live call.
	 */
	child?: RunStage[];
};

export type RunGraphEdge = {
	from: string;
	to: string;
	label?: string;
	condition?: string;
};

/** The workflow graph of a factory run, from `GET /runs/{id}/graph` of its box. */
export type RunGraph = { nodes: RunGraphNode[]; edges: RunGraphEdge[] };

/** A factory run of a ticket that a newer run replaced, such as a failed run before its retry. */
export type EarlierFactoryRun = Pick<
	FactoryRun,
	"statusKind" | "factory" | "startedAt" | "endedAt"
> & { result?: RunResult };

/** The fixed categories in workflow order. The domain rules read only these. */
export const statusTypes = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const;

export type StatusType = (typeof statusTypes)[number];

export type StatusColours = Record<StatusType, string>;

export type TicketState = StatusType;

export type TicketRef = {
	tracker: Tracker;
	project: string;
	key: string;
	state?: "open" | "closed";
	title?: string;
	projectName?: string;
};

export type Comment = {
	id?: string;
	body: string;
	createdAt?: string;
	updatedAt?: string;
	author?: string;
	reactions?: number;
};

export type TicketStatus = {
	id: string;
	name: string;
	statusType: StatusType;
	colour: string;
};

export type Ticket = {
	id: string;
	tracker: Tracker;
	key: string | null;
	title: string;
	state: "open" | "closed";
	stateReason: string | null;
	updatedAt: string;
	ref?: string;
	body: string;
	blockedBy: TicketRef[];
	blocks?: TicketRef[];
	comments?: Comment[];
	milestone: string | null;
	parent: string | null;
	/** What the tracker read says about the parent ticket. */
	parentDetails?: ParentDetails;
	labels: string[];
	assignee?: string | null;
	assignees?: string[];
	status?: TicketStatus;
	emptyStatus?: boolean;
	history?: { statusId: string; at: string; statusType?: StatusType }[];
	closedAt?: string;
	createdAt?: string;
};

export type ParentDetails = {
	title: string;
	/** The lane state, absent when the tracker read says only that it is open. */
	state?: TicketState;
	project: string;
	url: string;
};

export type TicketRelation = {
	tracker: Tracker;
	project: string;
	key: string;
	title: string;
};

export type GraphLink = {
	key: string;
	done: boolean;
	outside?: TicketRelation;
};

export type GraphEnd = {
	project: string;
	key: string;
	tracker: Tracker;
	title: string;
	state?: TicketState;
};

export type ShownGraphLink = {
	from: GraphEnd;
	to: GraphEnd;
	done: boolean;
};

export type TicketView = {
	key: string | null;
	title: string;
	state: TicketState;
	blockers: string[];
	/** Each open blocker, resolved to its project and title. */
	blockedBy?: TicketRelation[];
	links?: GraphLink[];
	outsideBlockers?: TicketRelation[];
	blocks?: TicketRelation[];
	/** The label of the ticket's user state, which is its board column. */
	lane?: string;
	/** The tracker lane of the ticket, after evidence moves it forward, when its name differs from the lane. */
	status?: string;
	statusType?: StatusType;
	blocked?: boolean;
	staleStatus?: string;
	chips?: string[];
	pull?: string;
	pullUrl?: string;
	needsYou?: boolean;
	enteredStateAt?: string;
	run?: LiveRun;
	factoryRun?: ShownFactoryRun;
	/** The factory runs before `factoryRun`, newest first. */
	earlierFactoryRuns?: EarlierFactoryRun[];
	updatedAt?: string;
	assignees?: string[];
	workstream?: string;
	workstreamKey?: string;
	theme?: string;
	themeGroup?: string;
	parent?: string;
	subTickets?: number;
	/** How many direct sub-tickets are done. */
	subTicketsDone?: number;
	/** True when the ticket has sub-tickets and every descendant is done or dropped. */
	startsCollapsed?: true;
	/** The view is an unlinked PR, not a ticket. */
	unlinkedPr?: true;
};

export type CrossProjectBlocker = {
	project: string;
	tracker: Tracker;
	key: string;
	title: string;
};

/** A parent ticket that the project's tickets do not include. */
export type OutsideParent = CrossProjectBlocker & {
	state?: TicketState;
	url: string;
	/** The parent ticket's project is a tracked project. */
	tracked: boolean;
};

export type PullRequest = {
	repo: string;
	number: number;
	url: string;
	title: string;
	draft: boolean;
	branch: string;
	body: string;
	closingKeys: string[];
	headSha: string;
	headCommittedAt: string | null;
	merged: boolean;
	autoMerge?: boolean;
	checks: BotCheck[];
	comments: BotComment[];
	reviews: BotReview[];
	reactions: BotReaction[];
};

export type BotCheck = {
	name: string;
	status: string;
	conclusion: string | null;
};

export type BotComment = {
	login: string;
	body: string;
	createdAt: string | null;
	reactions?: number;
};

export const reviewStateValue = z.enum([
	"APPROVED",
	"CHANGES_REQUESTED",
	"COMMENTED",
	"DISMISSED",
	"PENDING",
]);

export type BotReview = {
	login: string;
	commitId: string;
	state?: z.infer<typeof reviewStateValue>;
};

export type BotReaction = {
	login: string;
	content: string;
	createdAt: string | null;
};

export type UnlinkedPr = {
	number: number;
	title: string;
	url: string;
	repo: string;
};

export type ProjectCounts = {
	name: string;
	tracker: Tracker;
	ref: Configuration["tracked"][number];
	done: number;
	dropped: number;
	blocked: number;
	backlog: number;
	inProgress: number;
	inReview: number;
	awaitingMerge: number;
	unlinkedPrs: UnlinkedPr[];
	tickets: TicketView[];
	crossProjectBlockers: CrossProjectBlocker[];
	needsYou: number;
	progress: number;
	fetchedAt: string | null;
	error: string | null;
	tags: string[];
	statusTypes: Record<StatusType, number>;
	/** The card waits for its first read. */
	pending?: true;
};

export type ProjectBody = Omit<ProjectCounts, "ref">;

export type ThreadComment = {
	id: string;
	body: string;
	html: string;
	author: string;
	createdAt: string;
	url: string;
	parentId: string | null;
	kind: "comment" | "review";
	children: ThreadComment[];
};

export type Thread = {
	tracker: Tracker;
	project: string;
	key: string;
	title: string;
	url: string;
	comments: ThreadComment[];
};

export type FetchedThread = Omit<Thread, "comments"> & {
	comments: Omit<ThreadComment, "html">[];
};

export type ReplyRequest = {
	tracker: Tracker;
	project: string;
	key: string;
	body: string;
	parentId?: string;
	kind?: "comment" | "review";
};

export type PostedReply = {
	id: string;
	body: string;
	url: string;
	createdAt: string;
};

export type AskOption = {
	number: number;
	label: string;
};

export type PullStatus = {
	number: number;
	title: string;
	url: string;
	ci: "passing" | "failing" | "pending" | "none";
	review: "approved" | "changes" | "completed" | "pending" | "none";
};

export type NeedsYouItem = {
	project: string;
	tracker: Tracker;
	key: string;
	headline: string;
	reason: "ask" | "awaitingMerge" | "label" | "runFailed";
	tags: string[];
	answered: boolean;
	acknowledged: boolean;
	question?: string;
	options?: AskOption[];
	pull?: PullStatus;
	/** The factory question that the ask comes from, and the run that waits on it. */
	factoryAsk?: { factory: string; run: string; question: string };
};

export type NotificationTrigger = "needsYou" | "comment" | "blockerCleared";

export type Notification = {
	id: string;
	trigger: NotificationTrigger;
	project: string;
	key: string;
	text: string;
	at: string;
	read: boolean;
};

export type Attention = {
	needsYou: NeedsYouItem[];
	comments: Map<
		string,
		{
			stamp: string;
			replyStamp: string;
			authors: string[];
			project: string;
			key: string;
		}
	>;
	blockers: Map<
		string,
		{ project: string; tracker: string; key: string; title: string }
	>;
	closed: Set<string>;
	closedBlockers: Set<string>;
};

export type InboxDay = "today" | "yesterday" | "earlier";

export type InboxEntry = Notification & {
	day: InboxDay;
	tracker: Tracker;
};

export type ReportSection = {
	id: "summary" | "inFlight" | "needsYou" | "backlog";
	title: string;
	text?: string;
	items?: TicketView[];
	needsYou?: NeedsYouItem[];
};

export type Lane = {
	id: string;
	name: string;
	colour: string;
	statusType: StatusType;
	added?: boolean;
	evidence?: StatusType;
};

export type ProjectReport = {
	name: string;
	tracker: Tracker;
	/** The user states, in board column order. */
	lanes: Lane[];
	/** The tracker lanes of the project's board. */
	statuses: Lane[];
	tickets: TicketView[];
	sections: ReportSection[];
	done: number;
	total: number;
	doneTickets: TicketView[];
	graphTickets: TicketView[];
	graphLinks: ShownGraphLink[];
	/** The parent tickets of graph tickets that the graph does not show itself. Each heads the frame of its shown sub-tickets. */
	graphParents: TicketView[];
	outsideParents: OutsideParent[];
	/** Filters that leave no ticket on the board, graph or table. */
	hiddenBy?: HidingFilter[];
};

export type Overview = {
	projects: ProjectCounts[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
	tracked?: false;
	/** A listed factory did not answer its last check. */
	factoryUnreachable?: true;
};

/** Projects finished in the poll that is running, out of the tracked projects. */
export type PollProgress = {
	done: number;
	total: number;
	project: string | null;
	ended: boolean;
};

export type FetchStatus = {
	fetchedAt: string | null;
	error: string | null;
};

export type Board = {
	kind: "linear" | "github-project" | "github-repo";
	laneKey?: string;
	statuses: TicketStatus[];
	factoryLabels: boolean;
};

export type Snapshot = {
	key: string;
	name: string;
	tracker: Tracker;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	owner?: string;
	number?: number;
	listedEmpty?: boolean;
};

export type ProjectPoll = {
	ref: ProjectRef;
	ok: boolean;
	error: string | null;
	full: boolean;
	row: Snapshot | null;
};

export type PollReconcile = {
	rows: Snapshot[];
	projectErrors: { ref: ProjectRef; error: string }[];
	globalError: string | null;
};

/** The tickets of one project, with its repo when the project is a GitHub repo. */
export type ProjectGroup = {
	project: string;
	repo: string | null;
	tickets: Ticket[];
};

export type ListedProject = {
	key: string;
	name?: string;
	tracker: Tracker;
	owner?: string;
	number?: number;
	updatedAt: string | null;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	closed?: boolean;
};

export type ShownTicket = {
	state: TicketState;
	lane: Lane;
	staleStatus?: string;
	chips: string[];
	runFailed: boolean;
	enteredStateAt: string;
	blocked: boolean;
	run?: LiveRun;
};

export type NeedsYouRules = {
	pmBot: boolean;
	labels: string[];
	viewerLogins: string[];
};

export type GroupKey = Exclude<GroupBy, "none">;

export type SettingsProject = {
	name: string;
	key: string;
	tracker: Tracker;
	source: "found" | "configured";
	tracked: boolean;
	pmBot: boolean;
	repos: string[];
	expectedBots: KnownBot[];
	repoBots: Record<string, KnownBot[]>;
	ref: ProjectPin;
};

export type SettingsSnapshot = Pick<
	Snapshot,
	"key" | "name" | "tracker" | "owner" | "number" | "board"
> & {
	pulls: Pick<
		PullRequest,
		"repo" | "merged" | "checks" | "comments" | "reviews" | "reactions"
	>[];
};

export type FocusLink = { from: string; to: string };
