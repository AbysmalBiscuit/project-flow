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

/** A workcell run that a factory reports in `GET /runs`. */
export type FactoryRun = {
	id: string;
	key: string;
	repo?: string;
	statusKind: RunStatusKind;
	/** The box that does the run. Null while the run waits in the hub queue. */
	box: string | null;
	factory: string;
	submittedAt: string;
	startedAt: string | null;
	endedAt: string | null;
	/** False when the factory did not answer its last read. */
	coveredByFeed: boolean;
};

/** The newest factory run of a ticket. The stage comes from the progress comment. */
export type ShownFactoryRun = Pick<
	FactoryRun,
	"statusKind" | "box" | "factory" | "startedAt" | "endedAt" | "coveredByFeed"
> & { stage?: string };

/** A factory run of a ticket that a newer run replaced, such as a failed run before its retry. */
export type EarlierFactoryRun = Pick<
	FactoryRun,
	"statusKind" | "startedAt" | "endedAt"
>;

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
