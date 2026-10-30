import type { AutoMerge, Configuration } from "./configuration.ts";
import type {
	FactoryRun,
	FetchedThread,
	LinearShown,
	LinearSource,
	Notification,
	Overview,
	PollProgress,
	PostedReply,
	PullRequest,
	ReplyRequest,
	RunAgent,
	RunArtifactContent,
	RunDetail,
	Snapshot,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import type {
	AnswerResult,
	CancelResult,
	ClaimResult,
	RemoveAction,
	RemoveResult,
	StartResult,
	Steer,
	SteerResult,
} from "./factory-run-actions.ts";
import type { ArtifactsRead } from "./factory-run-artifacts.ts";
import type { CheckpointRead } from "./factory-run-detail.ts";
import type { FilesRead } from "./factory-run-files.ts";
import type { SandboxRead } from "./factory-run-sandbox.ts";
import type { RunSettingsRead } from "./factory-run-settings.ts";
import type { SourceRead } from "./factory-run-source.ts";
import type { TranscriptRead } from "./factory-run-transcript.ts";
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
	host?: string;
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

/** A reference from one ticket to one PR. */
export type PullLink = { repo: string; number: number; ticketKey: string };

export type PullLinks = {
	links: PullLink[];
	/** The repos whose merged history the PRs of the project also read. */
	repos: string[];
};

/** A URL on one ticket that can name a PR on a forge. */
export type PullRef = { url: string; ticketKey: string };

export type Tracker = {
	/** Drop repo reads from the previous poll, including a poll that failed. */
	beginPoll?: () => void;
	/** Drop the cached reads of one project, so the next read of it asks the tracker again. */
	forgetProject?: (project: TrackedProject) => void;
	listTickets: (
		project: TrackedProject,
		since: Date | null,
		held?: Ticket[],
	) => Promise<TicketList>;
	findProjects: () => Promise<{
		projects: FoundProject[];
		viewer: Viewer | null;
		error?: string;
	}>;
	/**
	 * When the full read interval of a stored project starts in a launch with no
	 * full read of it. Without this capability, its first read is a full read.
	 */
	fullReadIntervalStart?: (polledAt: Date) => Date;
	/** Find a pinned project that `findProjects` did not list. */
	findPinnedProject?: (
		owner: string,
		number: number,
	) => Promise<FoundProject | null>;
	/** The PR links of a project whose tickets sit on a board across repos. */
	pullLinks?: (project: TrackedProject) => Promise<PullLinks>;
	/** The URLs on the tickets of a project that holds no PRs itself. The forge of each URL's host reads the PR. */
	pullRefs?: (
		project: TrackedProject,
		since: Date | null,
	) => Promise<PullRef[]>;
	projectsForKeys?: (keys: string[]) => Promise<FoundProject[]>;
	fetchThread?: (
		project: string,
		key: string,
		signal?: AbortSignal,
	) => Promise<FetchedThread | null>;
	postReply?: (reply: ReplyRequest) => Promise<PostedReply>;
	/** Add the label to the ticket. A Linear label must exist in the ticket's team or the workspace. */
	addLabel?: (key: string, label: string) => Promise<void>;
	/** Move a Linear ticket into the workflow state, add and remove the labels, in one update. Answers its new status and labels. */
	showState?: (
		key: string,
		shown: LinearShown,
	) => Promise<Required<Pick<Ticket, "status" | "labels">>>;
};

/** Reads the factories that this launch lists. */
export type FactoryReader = {
	/** Check each factory again. */
	check: () => Promise<void>;
	/** Wait for the running check, and check a factory that has none. */
	settled: () => Promise<void>;
	/** Each listed factory with what its last check found. */
	entries: () => FactoryEntry[];
	/** The Linear sources of each listed hub, from its last good `GET /sources`. */
	linearSources: () => LinearSource[];
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
	 * The run of each listed factory with this id, with its last event and the
	 * name of its workflow graph when a read has found it.
	 * Null when no factory reported the run.
	 */
	run: (runId: string) => RunDetail | null;
	/**
	 * `GET /runs/{id}/graph` of the factory whose row gives the run its status.
	 * True when the read finds a workflow name that `run` did not give.
	 */
	readWorkflow: (runId: string) => Promise<boolean>;
	/**
	 * `GET /runs/{id}/checkpoint` and `GET /runs/{id}/turns` of the factory whose row gives the run its status.
	 * "missing" when no factory reported the run or the factory gave no checkpoint,
	 * and "not served" when the factory answered the checkpoint read with 404.
	 */
	checkpoint: (runId: string) => Promise<CheckpointRead>;
	/**
	 * `GET /runs/{id}/workers` of the factory whose row gives the run its status:
	 * each agent whose turn runs, and the agent of the current stage.
	 * Empty without a read when the run is not live. Null when no factory reported the run.
	 */
	agents: (runId: string) => Promise<RunAgent[] | null>;
	/**
	 * `GET /runs/{id}/events` of the hub that reports the run, or else of its box, as server-sent events.
	 * Null when no factory reported the run.
	 */
	events: (
		runId: string,
		lastEventId: string | null,
		client: AbortSignal,
	) => Response | null;
	/**
	 * `GET /runs/{id}/artifacts` of the hub that reports the run, or else of its box.
	 * "missing" when no factory reported the run or the factory did not answer,
	 * and "not served" when the factory answered with 404.
	 */
	artifacts: (runId: string) => Promise<ArtifactsRead>;
	/**
	 * `GET /runs/{id}/artifacts/{folder}/{name}` of the hub that reports the run, or else of its box.
	 * Null when no factory reported the run, or the factory gave no such artifact.
	 */
	artifact: (
		runId: string,
		folder: string,
		name: string,
	) => Promise<RunArtifactContent | null>;
	/**
	 * `GET /runs/{id}/sandbox` of the hub that reports the run, or else of its box.
	 * "missing" when no factory reported the run or the factory did not answer,
	 * and "not served" when the factory answered with 404.
	 */
	sandbox: (runId: string) => Promise<SandboxRead>;
	/**
	 * `GET /runs/{id}/files` of the hub that reports the run, or else of its box.
	 * "gone" when the files answer 404 and the run sandbox is removed.
	 * "not served" when the files answer 404 and the factory does not serve the sandbox either, or the sandbox has a worktree.
	 * "missing" otherwise: no factory reported the run, the factory did not answer, or the run has no worktree yet.
	 */
	files: (runId: string) => Promise<FilesRead>;
	/**
	 * `GET /runs/{id}/source` of the hub that reports the run, or else of its box.
	 * "missing" when no factory reported the run, the factory did not answer or the run has not loaded its package,
	 * and "not served" when the factory answered with 404.
	 */
	source: (runId: string) => Promise<SourceRead>;
	/**
	 * `GET /runs/{id}/stages/{stage}/transcript?after=` of the hub that reports the run, or else of its box:
	 * the entries of the stage after the cursor `after`. `stage` is the node path of the stage.
	 * "missing" when no factory reported the run or the factory did not answer,
	 * and "not served" when the factory answered with 404.
	 */
	transcript: (
		runId: string,
		stage: string,
		after: number,
	) => Promise<TranscriptRead>;
	/**
	 * `GET /runs/{id}/settings` of the hub that reports the run, or else of its box.
	 * "missing" when no factory reported the run or the factory did not answer,
	 * and "not served" when the factory answered with 404.
	 */
	settings: (runId: string) => Promise<RunSettingsRead>;
	/**
	 * Post an answer to an open question of a run, on the factory whose row gives the run its status.
	 * Answers, steers, cancels, resumes, restarts, deletes and archives are the only write requests that the app sends to a factory.
	 */
	answer: (
		run: string,
		question: string,
		text: string,
	) => Promise<AnswerResult>;
	/** Post a steer to the worker of one stage of a run, on the hub that reports the run, or else on its box. */
	steer: (run: string, steer: Steer) => Promise<SteerResult>;
	/** Cancel a run, on the hub that reports the run, or else on its box. The factory stops the run as failed. */
	cancel: (run: string) => Promise<CancelResult>;
	/** Queue a blocked or failed run again from its run checkpoint, on the hub that reports the run, or else on its box. */
	resume: (run: string) => Promise<StartResult>;
	/** Start a new run on the ticket of a blocked or failed run, on the hub that reports the run, or else on its box. */
	restart: (run: string) => Promise<StartResult>;
	/**
	 * Delete or archive an ended run, on the hub that reports the run, or else on its box.
	 * A delete drops the run from the factory. An archive keeps it out of the plain `GET /runs`.
	 */
	remove: (run: string, action: RemoveAction) => Promise<RemoveResult>;
	/** Start a claimed run of a ticket on the factory at `url`, which starts it now or queues it. */
	claimStart: (
		url: string,
		start: { repo: string; ticket: string },
	) => Promise<ClaimResult>;
};

export type Forge = {
	/** Drop repo reads from the previous poll, including a poll that failed. */
	beginPoll?: () => void;
	/** Drop the cached reads of one repo, so the next read of it asks the forge again. */
	forgetRepo?: (repo: string) => void;
	listPulls: (repo: string) => Promise<PullRequest[]>;
	/** The PR of each link, then the merged history of each repo of those PRs and of `repos`. */
	listLinkedPulls: (
		links: PullLink[],
		repos: string[],
	) => Promise<PullRequest[]>;
	listBranches: (repo: string) => Promise<string[]>;
	repoAutoMerge: (repo: string) => Promise<boolean>;
	/** The repo and number of the PR that this URL names, or null for any other URL. */
	pullOfUrl: (url: URL) => Pick<PullLink, "repo" | "number"> | null;
};

export type Store = {
	replaceTickets: (rows: Snapshot[]) => void;
	/** The stored rows, the same objects until the next write to them. Callers do not change them. */
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
