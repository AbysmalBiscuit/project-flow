import type { Configuration } from "./configuration.ts";
import type { Overview, PullRequest, Ticket } from "./domain.ts";

export type Clock = {
	now: () => Date;
};

export type TodoSource = () => Promise<string>;

export type LocalCheckout = {
	repo: string;
	tracker: "github" | "linear";
	path?: string;
	originOwner?: string;
	hasTrackerConfig?: boolean;
	names?: string[];
};

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
};

export type Snapshot = {
	key: string;
	name: string;
	tracker: "github" | "linear";
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
};

export type TicketList = {
	name: string;
	tickets: Ticket[];
};

export type Tracker = {
	listTickets: (project: string, since: Date | null) => Promise<TicketList>;
	listPulls: (project: string) => Promise<PullRequest[]>;
	listBranches: (project: string) => Promise<string[]>;
	findProjects: () => Promise<{
		projects: FoundProject[];
		viewer: Viewer | null;
	}>;
	projectsForKeys?: (keys: string[]) => Promise<FoundProject[]>;
};

export type Store = {
	replaceTickets: (rows: Snapshot[]) => void;
	readTickets: () => Snapshot[];
	mergeTickets: (rows: Snapshot[]) => void;
	lastGoodPollAt: (project: string) => Date | null;
	recordGoodPoll: (project: string, at: Date) => void;
	recordFetchError: (message: string) => void;
	fetchStatus: () => { fetchedAt: string | null; error: string | null };
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
