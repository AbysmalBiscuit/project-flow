import type { Configuration } from "./configuration.ts";
import type {
	Overview,
	PostedReply,
	PullRequest,
	ReplyRequest,
	Snapshot,
	Thread,
	Ticket,
} from "./domain.ts";

export type { Snapshot };

export type Clock = {
	now: () => Date;
};

export type TodoSource = () => Promise<string>;

type CheckoutNames = {
	path: string;
	names: string[];
};

export type LocalCheckout = CheckoutNames &
	(
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

export type CheckoutSource = () => Promise<LocalCheckout[]>;

export type FoundProject = {
	key: string;
	name?: string;
	tracker: "github" | "linear";
	updatedAt: string | null;
	owner?: string;
	number?: number;
	closed?: boolean;
};

export type Viewer = {
	login: string;
	orgs: string[];
	id?: string;
};

export type TicketList = {
	name: string;
	tickets: Ticket[];
};

export type Tracker = {
	listTickets: (project: string, since: Date | null) => Promise<TicketList>;
	listPulls: (project: string, since?: Date | null) => Promise<PullRequest[]>;
	listBranches: (project: string) => Promise<string[]>;
	findProjects: () => Promise<{
		projects: FoundProject[];
		viewer: Viewer | null;
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
	recordFetchError: (message: string) => void;
	recordProjectError: (project: string, message: string) => void;
	clearProjectError: (project: string) => void;
	projectError: (project: string) => string | null;
	fetchStatus: () => { fetchedAt: string | null; error: string | null };
	recordReply: (key: string, at: string) => void;
	replyAfter: (key: string) => string | null;
};

export type Change = {
	overview: Overview;
};

export type Notifier = {
	publish: (change: Change) => void;
	subscribe: (send: (change: Change) => void) => () => void;
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
};
