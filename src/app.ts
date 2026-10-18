import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import {
	projectCounts,
	projectSnapshots,
	startedTodoKeys,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubProjectByNumber, githubTracker } from "./github.ts";
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

function refKey(ref: Configuration["pinned"][number]): string {
	if (ref.tracker === "linear") {
		return ref.project;
	}
	if ("repo" in ref) {
		return ref.repo;
	}
	return `${ref.owner}/${ref.project}`;
}

function matchesRef(
	project: FoundProject,
	ref: Configuration["pinned"][number],
): boolean {
	if (project.tracker !== ref.tracker) {
		return false;
	}
	if (ref.tracker === "linear") {
		return project.key === ref.project;
	}
	if ("repo" in ref) {
		return project.key === ref.repo;
	}
	return project.owner === ref.owner && project.number === ref.project;
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
	token: string;
	fetch: Fetch;
	listTodos?: TodoSource | undefined;
}): Promise<Configuration> {
	const configuration = await options.configuration.read();
	const startedKeys = startedTodoKeys((await options.listTodos?.()) ?? "");
	const linear = options.linear;
	if (
		linear === null &&
		configuration.pinned.some((pin) => pin.tracker === "linear")
	) {
		throw new Error(missingLinearKey);
	}
	const discovered = await options.github.findProjects();
	if (linear !== null) {
		mergeFound(discovered, await linear.findProjects());
	}
	const found = [...discovered];
	for (const pin of configuration.pinned) {
		if (found.some((project) => matchesRef(project, pin))) {
			continue;
		}
		if (pin.tracker === "github" && "project" in pin) {
			const located = await githubProjectByNumber(
				options.token,
				options.fetch,
				pin.owner,
				pin.project,
			);
			if (located !== null) {
				found.push(located);
			}
			continue;
		}
		found.push({
			key: refKey(pin),
			tracker: pin.tracker,
			updatedAt: null,
		});
	}
	const pinnedKeys = new Set(
		found
			.filter((project) =>
				configuration.pinned.some((pin) => matchesRef(project, pin)),
			)
			.map((project) => project.key),
	);
	const hiddenKeys = new Set(
		found
			.filter((project) =>
				configuration.hidden.some((pin) => matchesRef(project, pin)),
			)
			.map((project) => project.key),
	);
	const listed = [];
	for (const project of found) {
		const tracker = project.tracker === "github" ? options.github : linear;
		if (tracker === null) {
			throw new Error(missingLinearKey);
		}
		const pulls = await tracker.listPulls(project.key);
		const branches =
			project.tracker === "github"
				? await options.github.listBranches(project.key)
				: [];
		listed.push({
			...project,
			tickets: await tracker.listTickets(project.key),
			pulls,
			branches,
			startedKeys,
			pinned: pinnedKeys.has(project.key),
			hidden: hiddenKeys.has(project.key),
			...(project.closed === undefined ? {} : { closed: project.closed }),
		});
	}
	options.store.replaceTickets(
		projectSnapshots(
			listed,
			options.clock.now(),
			configuration.activityWindowDays,
		),
	);
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
		token: options.token,
		fetch: options.fetch,
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
