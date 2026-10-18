import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import { projectCounts, showsProject, startedTodoKeys } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubTracker } from "./github.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import type {
	Clock,
	ConfigurationPort,
	FoundProject,
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

function overview(store: Store): Overview {
	return {
		projects: store.readTickets().map((row) =>
			projectCounts(
				row.name,
				row.tracker,
				row.tickets,
				row.pulls,
				row.branches,
				row.startedKeys,
			),
		),
	};
}

function mergeFound(
	found: FoundProject[],
	next: FoundProject[],
): FoundProject[] {
	const seen = new Set(
		found.map((project) => `${project.tracker}:${project.key}`),
	);
	for (const project of next) {
		const id = `${project.tracker}:${project.key}`;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		found.push(project);
	}
	return found;
}

async function poll(options: {
	configuration: ConfigurationPort;
	github: Tracker;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
	listTodos?: TodoSource | undefined;
}): Promise<Configuration> {
	const configuration = await options.configuration.read();
	const startedKeys = startedTodoKeys((await options.listTodos?.()) ?? "");
	const found = mergeFound(
		configuration.pinned.map((pin) => ({
			key: pinKey(pin),
			tracker: pin.tracker,
			updatedAt: null,
		})),
		await options.github.findProjects(),
	);
	if (options.linear !== null) {
		mergeFound(found, await options.linear.findProjects());
	} else if (configuration.pinned.some((pin) => pin.tracker === "linear")) {
		throw new Error(missingLinearKey);
	}
	const rows = [];
	const claimed = new Set<string>();
	const projects = [
		...found.filter(
			(project) => project.tracker === "github" && !project.key.includes("/"),
		),
		...found.filter(
			(project) => project.tracker === "linear" || project.key.includes("/"),
		),
	];
	const hidden = new Set(configuration.hidden.map(pinKey));
	const pinned = new Set(configuration.pinned.map(pinKey));
	const now = options.clock.now();
	for (const project of projects) {
		const tracker =
			project.tracker === "github" ? options.github : options.linear;
		if (tracker === null) {
			throw new Error(missingLinearKey);
		}
		const listed = await tracker.listTickets(project.key);
		const tickets = listed.filter((ticket) => {
			if (ticket.ref === undefined || claimed.has(ticket.ref)) {
				return ticket.ref === undefined;
			}
			claimed.add(ticket.ref);
			return true;
		});
		const openTickets = tickets.filter(
			(ticket) => ticket.state === "open",
		).length;
		const ticketUpdated = tickets.reduce<string | null>((latest, ticket) => {
			if (ticket.updatedAt === undefined) {
				return latest;
			}
			return latest === null || ticket.updatedAt > latest
				? ticket.updatedAt
				: latest;
		}, null);
		const updatedAt =
			project.updatedAt === null
				? ticketUpdated
				: ticketUpdated === null || project.updatedAt > ticketUpdated
					? project.updatedAt
					: ticketUpdated;
		if (
			!showsProject({
				pinned: pinned.has(project.key),
				hidden: hidden.has(project.key),
				openTickets,
				updatedAt,
				now,
				activityWindowDays: configuration.activityWindowDays,
			})
		) {
			continue;
		}
		const pulls = await tracker.listPulls(project.key);
		const branches =
			project.tracker === "github"
				? await options.github.listBranches(project.key)
				: [];
		rows.push({
			key: project.key,
			name: project.name ?? project.key,
			tracker: project.tracker,
			tickets,
			pulls,
			branches,
			startedKeys,
		});
	}
	options.store.replaceTickets(rows);
	return configuration;
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	await poll({
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
