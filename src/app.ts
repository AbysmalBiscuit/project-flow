import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import { projectCounts, startedTodoKeys } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubTracker } from "./github.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import type {
	Clock,
	ConfigurationPort,
	Store,
	TodoSource,
	Tracker,
} from "./ports.ts";
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
	listTodos?: TodoSource;
};

export type Running = {
	url: URL;
	stop: () => Promise<void>;
};

function pinKey(pin: Configuration["pinned"][number]): string {
	return pin.tracker === "github" ? pin.repo : pin.project;
}

function overview(store: Store, configuration: Configuration): Overview {
	const rows = new Map(store.readTickets().map((row) => [row.project, row]));
	return {
		projects: configuration.pinned.flatMap((pin) => {
			const key = pinKey(pin);
			const row = rows.get(key);
			if (row === undefined) {
				return [];
			}
			return [
				projectCounts(
					key,
					pin.tracker,
					row.tickets,
					row.pulls,
					row.branches,
					row.startedKeys,
				),
			];
		}),
	};
}

async function poll(options: {
	configuration: ConfigurationPort;
	github: Tracker;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
	listTodos?: TodoSource | undefined;
}): Promise<Configuration> {
	void options.clock;
	const configuration = await options.configuration.read();
	const startedKeys = startedTodoKeys((await options.listTodos?.()) ?? "");
	const rows = [];
	for (const pin of configuration.pinned) {
		const key = pinKey(pin);
		if (pin.tracker === "github") {
			const tickets = await options.github.listTickets(key);
			const pulls = await options.github.listPulls(key);
			const branches = await options.github.listBranches(key);
			rows.push({ project: key, tickets, pulls, branches, startedKeys });
			continue;
		}
		if (options.linear === null) {
			throw new Error(missingLinearKey);
		}
		const tickets = await options.linear.listTickets(key);
		const pulls = await options.linear.listPulls(key);
		rows.push({
			project: key,
			tickets,
			pulls,
			branches: [],
			startedKeys,
		});
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
				: linearTracker(options.linearKey, options.fetch, options.token),
		store: opened.store,
		clock: { now: options.now ?? (() => new Date()) },
		listTodos: options.listTodos,
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
