import type { Configuration } from "./configuration.ts";
import type { PullRequest, Ticket } from "./domain.ts";

export type Clock = {
	now: () => Date;
};

export type TodoSource = () => Promise<string>;

export type Snapshot = {
	project: string;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	startedKeys: string[];
};

export type Tracker = {
	listTickets: (project: string) => Promise<Ticket[]>;
	listPulls: (project: string) => Promise<PullRequest[]>;
	listBranches: (project: string) => Promise<string[]>;
};

export type Store = {
	replaceTickets: (rows: Snapshot[]) => void;
	readTickets: () => Snapshot[];
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
};
