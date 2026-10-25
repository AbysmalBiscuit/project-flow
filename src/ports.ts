import type { AutoMerge, Configuration } from "./configuration.ts";
import type {
	FactoryRun,
	FetchedThread,
	Notification,
	Overview,
	PollProgress,
	PostedReply,
	PullRequest,
	ReplyRequest,
	RunAgent,
	RunCheckpoint,
	Snapshot,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
import type {
	AnswerResult,
	FactoryEntry,
	Steer,
	SteerResult,
} from "./factories.ts";
import type { ProjectRef } from "./project-ref.ts";

export type { Snapshot, WorkcellRun };

export type Clock = {
	now: () => Date;
};

export type TodoSource = () => Promise<string>;

type CheckoutNames = {
	path: string;
	names: string[];
};

export type LocalCheckout = CheckoutNames & {
	runs?: WorkcellRun[];
	mergeAuto?: AutoMerge;
	repo?: string;
} & (
		| {
				tracker: "github";
				repo: string;
				originOwner: string;
				hasTrackerConfig: boolean;
		  }
		| {
				tracker: "linear";
		  }
	);

export type CheckoutSource = (roots: string[]) => Promise<LocalCheckout[]>;

export type FoundProject = {
	key: string;
	name?: string;
	tracker: Snapshot["tracker"];
	updatedAt: string | null;
	owner?: string;
	number?: number;
	closed?: boolean;
	configuredOnly?: boolean;
};

/** A found project that poll resolved to its ProjectRef. */
export type TrackedProject = FoundProject & { ref: ProjectRef };

export type Viewer = {
	login: string;
	orgs: string[];
	id?: string;
};

export type TicketList = {
	name: string;
	tickets: Ticket[];
	board?: Snapshot["board"];
};

export type Tracker = {
	/** Drop repo reads from the previous poll, including a poll that failed. */
	beginPoll?: () => void;
	listTickets: (
		project: TrackedProject,
		since: Date | null,
		held?: Ticket[],
	) => Promise<TicketList>;
	listPulls: (
		project: TrackedProject,
		since?: Date | null,
	) => Promise<PullRequest[]>;
	findProjects: () => Promise<{
		projects: FoundProject[];
		viewer: Viewer | null;
		error?: string;
	}>;
	projectsForKeys?: (keys: string[]) => Promise<FoundProject[]>;
	fetchThread?: (
		project: string,
		key: string,
		signal?: AbortSignal,
	) => Promise<FetchedThread | null>;
	postReply?: (reply: ReplyRequest) => Promise<PostedReply>;
};

/** Reads the factories that this launch lists. */
export type FactoryReader = {
	/** Check each factory again. */
	check: () => Promise<void>;
	/** Wait for the running check, and check a factory that has none. */
	settled: () => Promise<void>;
	/** Each listed factory with what its last check found. */
	entries: () => FactoryEntry[];
	/** True when the last check of a listed factory failed. */
	unreachable: () => boolean;
	/**
	 * Read `GET /runs` again of each factory without an open event stream, and of
	 * each streamed factory whose last read is older than the streamed run poll.
	 */
	readRuns: (now: number) => Promise<void>;
	/**
	 * Open the event stream of each factory that has none, and follow it.
	 * `around` runs each change that the stream brings.
	 */
	follow: (
		now: () => number,
		around: (change: () => Promise<void>) => Promise<void>,
	) => void;
	/** The runs of each listed factory, newest first. */
	runs: () => FactoryRun[];
	/**
	 * `GET /runs/{id}/checkpoint` of the factory whose row gives the run its status.
	 * Null when no factory reported the run or the factory gave no checkpoint.
	 */
	checkpoint: (runId: string) => Promise<RunCheckpoint | null>;
	/**
	 * `GET /runs/{id}/workers` of the factory whose row gives the run its status:
	 * each agent whose turn runs, and the agent of the current stage.
	 * Empty without a read when the run is not live. Null when no factory reported the run.
	 */
	agents: (runId: string) => Promise<RunAgent[] | null>;
	/**
	 * Post an answer to an open question of a run, on the factory whose row gives the run its status.
	 * Answers and steers are the only write requests that the app sends to a factory.
	 */
	answer: (
		run: string,
		question: string,
		text: string,
	) => Promise<AnswerResult>;
	/** Post a steer to the worker of one stage of a run, on the hub that reports the run, or else on its box. */
	steer: (run: string, steer: Steer) => Promise<SteerResult>;
};

export type GithubTracker = Tracker & {
	listBranches: (project: string) => Promise<string[]>;
	repoAutoMerge: (project: string) => Promise<boolean>;
	/** Find a pinned GitHub project that discovery did not list. */
	findPinnedProject: (
		owner: string,
		number: number,
	) => Promise<FoundProject | null>;
};

export type Store = {
	replaceTickets: (rows: Snapshot[]) => void;
	readTickets: () => Snapshot[];
	mergeTickets: (rows: Snapshot[]) => void;
	lastGoodPollAt: (project: ProjectRef) => Date | null;
	recordGoodPoll: (project: ProjectRef, at: Date) => void;
	forgetGoodPoll: (project: ProjectRef) => void;
	recordFetchError: (message: string) => void;
	recordProjectError: (project: ProjectRef, message: string) => void;
	clearProjectError: (project: ProjectRef) => void;
	projectError: (project: ProjectRef) => string | null;
	fetchStatus: () => { fetchedAt: string | null; error: string | null };
	readNotifications: () => Notification[];
	appendNotifications: (entries: Notification[]) => void;
	markNotificationRead: (id: string) => boolean;
	markNotificationsRead: (ids: readonly string[]) => void;
	/** Ids that must not notify again. */
	readSeededIds: () => string[];
	/** Record ids that must not notify again. */
	recordSeededIds: (ids: string[]) => void;
	/** Drop ids that must not notify again. */
	forgetSeededIds: (ids: string[]) => void;
	/** A number that changes on each write to the tickets, polls or errors. */
	revision: () => number;
};

export type Change = {
	overview: Overview;
	notifications: Notification[];
	progress?: PollProgress;
	/** The change touches only saved views, so tracker data stays the same. */
	viewsOnly?: true;
};

export type Notifier = {
	publish: (change: Change) => void;
	subscribe: (send: (change: Change) => void) => () => void;
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
	write: (text: string) => Promise<Configuration>;
};

/** A failed tracker request. `status` is the tracker's HTTP status, or 502 for a bad response body. */
export class TrackerError extends Error {
	readonly status: number;
	/** The messages of a GraphQL response that reported errors. */
	readonly graphqlErrors: readonly string[];

	constructor(
		message: string,
		status: number,
		graphqlErrors: readonly string[] = [],
	) {
		super(message);
		this.name = "TrackerError";
		this.status = status;
		this.graphqlErrors = graphqlErrors;
	}
}

export function isMissing(error: unknown): boolean {
	return (
		error instanceof TrackerError &&
		(error.status === 404 || error.status === 410)
	);
}
