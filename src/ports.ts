import type { AutoMerge, Configuration } from "./configuration.ts";
import type {
	Notification,
	Overview,
	PostedReply,
	PullRequest,
	ReplyRequest,
	Snapshot,
	Thread,
	Ticket,
	WorkcellRun,
} from "./domain.ts";

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
	listTickets: (project: string, since: Date | null) => Promise<TicketList>;
	listPulls: (project: string, since?: Date | null) => Promise<PullRequest[]>;
	listBranches: (project: string) => Promise<string[]>;
	repoAutoMerge: (project: string) => Promise<boolean>;
	findProjects: () => Promise<{
		projects: FoundProject[];
		viewer: Viewer | null;
		error?: string;
	}>;
	projectsForKeys?: (keys: string[]) => Promise<FoundProject[]>;
	fetchThread?: (project: string, key: string) => Promise<Thread | null>;
	postReply?: (reply: ReplyRequest) => Promise<PostedReply>;
};

export type Store = {
	replaceTickets: (rows: Snapshot[]) => void;
	readTickets: () => Snapshot[];
	mergeTickets: (rows: Snapshot[]) => void;
	lastGoodPollAt: (project: string) => Date | null;
	recordGoodPoll: (project: string, at: Date) => void;
	forgetGoodPoll: (project: string) => void;
	recordFetchError: (message: string) => void;
	recordProjectError: (project: string, message: string) => void;
	clearProjectError: (project: string) => void;
	projectError: (project: string) => string | null;
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
	/** Last GitHub REST response for a URL. */
	readValidators: () => {
		url: string;
		etag: string;
		body: string;
		headers: string;
	}[];
	/** Keep the last GitHub REST response for a URL. */
	recordValidator: (
		url: string,
		etag: string,
		body: string,
		headers: string,
	) => void;
	/** Drop the last GitHub REST response for a URL. */
	forgetValidator: (url: string) => void;
};

export type Change = {
	overview: Overview;
	notifications: Notification[];
};

export type Notifier = {
	publish: (change: Change) => void;
	subscribe: (send: (change: Change) => void) => () => void;
	latest: () => Change | null;
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
	write: (text: string) => Promise<Configuration>;
};
