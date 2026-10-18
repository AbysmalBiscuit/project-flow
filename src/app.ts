import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import { projectCounts } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubTracker } from "./github.ts";
import type { Clock, ConfigurationPort, Store, Tracker } from "./ports.ts";
import { sqliteStore } from "./store.ts";

const page = await Bun.file(new URL("./index.html", import.meta.url)).text();

export type { Overview } from "./domain.ts";
export type { Fetch } from "./fetch.ts";

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

async function cardsScript(): Promise<string> {
	const built = await Bun.build({
		entrypoints: [new URL("./cards.tsx", import.meta.url).pathname],
		target: "browser",
		format: "esm",
	});
	const output = built.outputs[0];
	if (output === undefined) {
		throw new Error("cards bundle is missing");
	}
	return output.text();
}

async function poll(options: {
	configuration: ConfigurationPort;
	tracker: Tracker;
	store: Store;
	clock: Clock;
}): Promise<void> {
	options.store.writePollTime(options.clock.now());
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
	const server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		routes: {
			"/": new Response(page, {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
			"/cards.js": new Response(await cardsScript(), {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			}),
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
