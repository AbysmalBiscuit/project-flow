import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import { projectCounts } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubTracker } from "./github.ts";
import page from "./index.html";
import type { Clock, ConfigurationPort, Store, Tracker } from "./ports.ts";
import { sqliteStore } from "./store.ts";

export type StartOptions = {
	configPath: string;
	token: string;
	fetch: Fetch;
	databasePath: string;
	hostname: string;
	port: number;
	now?: () => Date;
};

export type Running = {
	url: URL;
	stop: () => Promise<void>;
};

function overview(store: Store): Overview {
	return {
		projects: store
			.readTickets()
			.map((row) => projectCounts(row.repo, "github", row.tickets)),
	};
}

async function poll(options: {
	configuration: ConfigurationPort;
	tracker: Tracker;
	store: Store;
	clock: Clock;
}): Promise<void> {
	const configuration = await options.configuration.read();
	const rows = [];
	for (const pin of configuration.pinned) {
		const tickets = await options.tracker.listTickets(pin.repo);
		rows.push({ repo: pin.repo, tickets });
	}
	options.store.replaceTickets(rows);
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	await poll({
		configuration: { read: () => loadConfiguration(options.configPath) },
		tracker: githubTracker(options.token, options.fetch),
		store: opened.store,
		clock: { now: options.now ?? (() => new Date()) },
	});
	const server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		routes: {
			"/": page,
			"/api/overview": {
				GET: () => Response.json(overview(opened.store)),
			},
		},
	});
	return {
		url: server.url,
		stop: async () => {
			await server.stop(true);
			opened.close();
		},
	};
}
