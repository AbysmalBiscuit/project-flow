import { renderCards } from "./cards.tsx";
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
	options.clock.now();
	const configuration = await options.configuration.read();
	for (const pin of configuration.pinned) {
		const tickets = await options.tracker.listTickets(pin.repo);
		options.store.writeTickets(pin.repo, tickets);
	}
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	await poll({
		configuration: { read: () => loadConfiguration(options.configPath) },
		tracker: githubTracker(options.token, options.fetch),
		store: opened.store,
		clock: { now: options.now ?? (() => new Date()) },
	});
	const body = overview(opened.store);
	const shellPath = new URL("./index.html", import.meta.url);
	const shell = await Bun.file(shellPath).text();
	const emptyRoot = '<div id="root"></div>';
	const filledRoot = `<div id="root">${renderCards(body)}</div>`;
	await Bun.write(shellPath, shell.replace(emptyRoot, filledRoot));
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
			const current = await Bun.file(shellPath).text();
			if (current.includes(filledRoot)) {
				await Bun.write(shellPath, current.replace(filledRoot, emptyRoot));
			}
		},
	};
}
