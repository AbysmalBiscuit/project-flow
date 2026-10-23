import type { AutoMerge, Configuration } from "./configuration.ts";
import type {
	FetchedThread,
	Notification,
	Overview,
	PollProgress,
	PostedReply,
	PullRequest,
	ReplyRequest,
	Snapshot,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
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
	tracker: "github" | "linear";
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
