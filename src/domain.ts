import { z } from "zod";

import type {
	BooleanSetting,
	Configuration,
	ProjectPin,
} from "./configuration.ts";
import type { StatusType } from "./kinds.ts";
import type { KnownBot } from "./known-bots.ts";
import type { ProjectRef } from "./project-ref.ts";
import type {
	EarlierFactoryRun,
	LiveRun,
	Queued,
	RunStart,
	ShownFactoryRun,
} from "./run-domain.ts";
import type { HidingFilter } from "./terms.ts";
import type { GroupBy } from "./view-settings.ts";

export const trackerKinds = ["github", "linear"] as const;

export type TrackerKind = (typeof trackerKinds)[number];

export const forgeKinds = ["github"] as const;

export type ForgeKind = (typeof forgeKinds)[number];

/** A tracker or forge as the API lists it: its kind, its name and whether its token is set. */
export type BackendView<Kind extends TrackerKind | ForgeKind> = {
	kind: Kind;
	label: string;
	/** Where the token comes from. */
	hint: string;
	credential: "present" | "missing";
};

/** A setting of one backend, which Settings shows as a switch. */
export type BackendSwitch = {
	setting: BooleanSetting;
	label: string;
	hint: string;
};

/** The trackers, forges and backend switches that the settings read lists. */
export type BackendViews = {
	trackers: (BackendView<TrackerKind> & {
		/** True when a factory can claim a ticket of this tracker. */
		claimsRuns: boolean;
	})[];
	forges: BackendView<ForgeKind>[];
	switches: BackendSwitch[];
};

export * from "./kinds.ts";
export * from "./run-domain.ts";

export type StatusColours = Record<StatusType, string>;

export type TicketState = StatusType;

export type TicketRef = {
	tracker: TrackerKind;
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
	tracker: TrackerKind;
	key: string | null;
	title: string;
	/** The page of the ticket, as its tracker names it. */
	url?: string;
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
	tracker: TrackerKind;
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
	tracker: TrackerKind;
	title: string;
	/** The ticket's page on its tracker. */
	url?: string;
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
	/** The page of the ticket on its tracker, or of the PR for an unlinked PR. */
	url?: string;
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
	/** The name of the forge that holds the PR at `pullUrl`. */
	pullForge?: string;
	needsYou?: boolean;
	enteredStateAt?: string;
	run?: LiveRun;
	factoryRun?: ShownFactoryRun;
	/** The factory runs before `factoryRun`, newest first. */
	earlierFactoryRuns?: EarlierFactoryRun[];
	/** Present when Lev can start a factory run of the ticket. */
	runStart?: RunStart;
	/** Present when the ticket waits for the hub source loop to claim it. */
	queued?: Queued;
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
	tracker: TrackerKind;
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
	/** The declared host of the repo. A PR on the home host of its forge has none. */
	host?: string;
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
	/**
	 * A merged pull from an earlier read that the current merged page left
	 * out. It keeps the link of its ticket, but it does not make a ticket done
	 * and does not count toward the expected bots.
	 */
	retained?: true;
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
	tracker: TrackerKind;
	ref: Configuration["tracked"][number];
	/** The key of the project as the page shows it, such as `owner/number` for a board. */
	displayKey: string;
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

export type ProjectBody = Omit<ProjectCounts, "ref" | "displayKey">;

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
	tracker: TrackerKind;
	project: string;
	key: string;
	title: string;
	url: string;
	/** True when a reply can answer any comment, so each comment takes an answer. */
	threaded: boolean;
	comments: ThreadComment[];
};

export type FetchedThread = Omit<Thread, "comments"> & {
	comments: Omit<ThreadComment, "html">[];
};

export type ReplyRequest = {
	tracker: TrackerKind;
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
	/** The name of the forge that holds the PR. */
	forge?: string;
	ci: "passing" | "failing" | "pending" | "none";
	review: "approved" | "changes" | "completed" | "pending" | "none";
};

export type NeedsYouItem = {
	project: string;
	tracker: TrackerKind;
	key: string;
	headline: string;
	reason: "ask" | "awaitingMerge" | "decide" | "label" | "runFailed";
	tags: string[];
	answered: boolean;
	acknowledged: boolean;
	question?: string;
	options?: AskOption[];
	pull?: PullStatus;
	/** The count of Important Questions on the open PRs that have no answer. */
	openQuestions?: number;
	/** The factory question that the ask comes from, and the run that waits on it. */
	factoryAsk?: { factory: string; run: string; question: string };
};

export type NotificationTrigger = "needsYou" | "comment" | "blockerCleared";

export type Notification = {
	id: string;
	trigger: NotificationTrigger;
	project: string;
	tracker: TrackerKind;
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
			tracker: TrackerKind;
			key: string;
		}
	>;
	blockers: Map<
		string,
		{ project: string; tracker: TrackerKind; key: string; title: string }
	>;
	closed: Set<string>;
	closedBlockers: Set<string>;
};

export type InboxDay = "today" | "yesterday" | "earlier";

export type InboxEntry = Notification & {
	day: InboxDay;
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
	tracker: TrackerKind;
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
	/** The settings turn off the Needs you block of the overview. */
	needsYouHidden?: true;
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
	tracker: TrackerKind;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	host?: string;
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
	tracker: TrackerKind;
	host?: string;
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
	tracker: TrackerKind;
	source: "found" | "configured";
	tracked: boolean;
	pmBot: boolean;
	/** Whether PM Bot is on for this project when the configuration does not name it. */
	pmBotDefault: boolean;
	repos: string[];
	expectedBots: KnownBot[];
	repoBots: Record<string, KnownBot[]>;
	ref: ProjectPin;
	/** Each pin of the configuration that names this project, whatever its case. */
	savedPins: ProjectPin[];
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
