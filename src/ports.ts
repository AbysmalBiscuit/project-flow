import type { Configuration } from "./configuration.ts";
import type { Ticket } from "./domain.ts";

export type Clock = {
	now: () => Date;
};

export type Tracker = {
	listTickets: (repo: string) => Promise<Ticket[]>;
};

export type Store = {
	replaceTickets: (rows: { repo: string; tickets: Ticket[] }[]) => void;
	readTickets: () => { repo: string; tickets: Ticket[] }[];
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
};
