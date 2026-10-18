import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import { projectCounts } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubTracker } from "./github.ts";
import page from "./index.html";
import { linearTracker } from "./linear.ts";
import type { Clock, ConfigurationPort, Store, Tracker } from "./ports.ts";
import { sqliteStore } from "./store.ts";

export type StartOptions = {
	configPath: string;
	token: string;
	linearKey: string | null;
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

function overview(store: Store, configuration: Configuration): Overview {
	const rows = new Map(
		store.readTickets().map((row) => [row.repo, row.tickets]),
	);
	return {
		projects: configuration.pinned.flatMap((pin) => {
			const key = pin.tracker === "github" ? pin.repo : pin.project;
			const tickets = rows.get(key);
			if (tickets === undefined) {
				return [];
			}
			return [projectCounts(key, pin.tracker, tickets)];
		}),
	};
}

async function poll(options: {
	configuration: ConfigurationPort;
	github: Tracker;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
}): Promise<Configuration> {
	const configuration = await options.configuration.read();
	const rows = [];
	for (const pin of configuration.pinned) {
		if (pin.tracker === "github") {
			const tickets = await options.github.listTickets(pin.repo);
			rows.push({ repo: pin.repo, tickets });
			continue;
		}
		if (options.linear === null) {
			throw new Error(
				"LINEAR_API_KEY is missing: set LINEAR_API_KEY to list Linear projects.",
			);
		}
		const tickets = await options.linear.listTickets(pin.project);
		rows.push({ repo: pin.project, tickets });
	}
	options.store.replaceTickets(rows);
	return configuration;
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	const configuration = await poll({
		configuration: { read: () => loadConfiguration(options.configPath) },
		github: githubTracker(options.token, options.fetch),
		linear:
			options.linearKey === null
				? null
				: linearTracker(options.linearKey, options.fetch),
		store: opened.store,
		clock: { now: options.now ?? (() => new Date()) },
	});
	const server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		routes: {
			"/": page,
			"/api/overview": {
				GET: () => Response.json(overview(opened.store, configuration)),
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
