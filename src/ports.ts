import type { Configuration } from "./configuration.ts";
import type { Ticket } from "./domain.ts";

export type Clock = {
	now: () => Date;
};

export type Tracker = {
	listTickets: (project: string) => Promise<Ticket[]>;
};

export type Store = {
	replaceTickets: (rows: { project: string; tickets: Ticket[] }[]) => void;
	readTickets: () => { project: string; tickets: Ticket[] }[];
};

export type ConfigurationPort = {
	read: () => Promise<Configuration>;
};
