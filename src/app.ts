import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import {
	mergeTickets,
	projectCounts,
	projectSnapshots,
	staleView,
	startedTodoKeys,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubProjectByNumber, githubTracker } from "./github.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import { memoryNotifier } from "./notifier.ts";
import type {
	Clock,
	ConfigurationPort,
	FoundProject,
	Notifier,
	Store,
	TodoSource,
	Tracker,
} from "./ports.ts";
import { sqliteStore } from "./store.ts";

export type StartOptions = {
	configPath: string;
	token: string | null;
	linearKey: string | null;
	fetch: Fetch;
	databasePath: string;
	hostname: string;
	port: number;
	listTodos?: TodoSource;
	now?: () => Date;
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
	const rows = store.readTickets();
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	const projects = rows.map((row) =>
		projectCounts(
			row.name,
			row.tracker,
			row.tickets,
			row.pulls,
			row.branches,
			row.startedKeys,
			all,
		),
	);
	const goodPolls = projects.flatMap((project) => {
		const at = store.lastGoodPollAt(project.name);
		return at === null ? [] : [at.toISOString()];
	});
	return {
		projects,
		...staleView(
			store.fetchStatus(),
			goodPolls.length === 0 ? null : (goodPolls.sort()[0] ?? null),
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

function eventStream(notifier: Notifier): Response {
	let unsubscribe = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			unsubscribe = notifier.subscribe((change) => {
				controller.enqueue(
					encoder.encode(
						`event: overview\ndata: ${JSON.stringify(change.overview)}\n\n`,
					),
				);
			});
		},
		cancel() {
			unsubscribe();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}

type PollOptions = {
	configuration: ConfigurationPort;
	github: Tracker | null;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
	notifier: Notifier;
	token: string | null;
	fetch: Fetch;
	listTodos?: TodoSource | undefined;
	fallback: Configuration | null;
};

async function poll(options: PollOptions): Promise<Configuration | null> {
	const polledAt = options.clock.now();
	let configuration: Configuration;
	try {
		configuration = await options.configuration.read();
	} catch (error) {
		const message = error instanceof Error ? error.message : "poll failed";
		options.store.recordFetchError(message);
		if (options.fallback !== null) {
			options.notifier.publish({
				overview: overview(options.store),
			});
		}
		return options.fallback;
	}
	const startedKeys = startedTodoKeys((await options.listTodos?.()) ?? "");
	const linear = options.linear;
	if (
		linear === null &&
		configuration.pinned.some((pin) => pin.tracker === "linear")
	) {
		throw new Error(missingLinearKey);
	}
	const github = options.github;
	if (
		github === null &&
		configuration.pinned.some((pin) => pin.tracker === "github")
	) {
		throw new Error(
			'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".',
		);
	}
	const discovered = github === null ? [] : await github.findProjects();
	if (linear !== null) {
		mergeFound(discovered, await linear.findProjects());
	}
	const found = [...discovered];
	for (const pin of configuration.pinned) {
		if (found.some((project) => matchesRef(project, pin))) {
			continue;
		}
		if (pin.tracker === "github" && "project" in pin) {
			if (options.token === null) {
				throw new Error(
					'GITHUB_TOKEN is missing: set GITHUB_TOKEN or run "gh auth login".',
				);
			}
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
	let failed: string | null = null;
	const listed = [];
	for (const project of found) {
		const tracker = project.tracker === "github" ? github : linear;
		if (tracker === null) {
			throw new Error(missingLinearKey);
		}
		const since = options.store.lastGoodPollAt(project.key);
		try {
			const listedTickets = await tracker.listTickets(project.key, since);
			const pulls = await tracker.listPulls(project.key);
			const branches =
				project.tracker === "github" && github !== null
					? await github.listBranches(project.key)
					: [];
			listed.push({
				...project,
				name: project.name ?? listedTickets.name,
				tickets: listedTickets.tickets,
				pulls,
				branches,
				startedKeys,
				pinned: pinnedKeys.has(project.key),
				hidden: hiddenKeys.has(project.key),
				...(project.closed === undefined ? {} : { closed: project.closed }),
			});
			options.store.recordGoodPoll(project.key, polledAt);
		} catch (error) {
			failed = error instanceof Error ? error.message : "poll failed";
			const stored = options.store
				.readTickets()
				.find((row) => row.key === project.key);
			if (stored !== undefined) {
				listed.push({
					...project,
					tickets: stored.tickets,
					pulls: stored.pulls,
					branches: stored.branches,
					startedKeys,
					pinned: pinnedKeys.has(project.key),
					hidden: hiddenKeys.has(project.key),
					...(project.closed === undefined ? {} : { closed: project.closed }),
				});
			}
		}
	}
	const shown = projectSnapshots(
		listed,
		polledAt,
		configuration.activityWindowDays,
	);
	const previous = options.store.readTickets();
	const shownKeys = new Set(shown.map((row) => row.key));
	const carried = previous.filter((row) => {
		if (shownKeys.has(row.key)) {
			return false;
		}
		return failed !== null && found.some((project) => project.key === row.key);
	});
	const stored = [...shown, ...carried].map((row) => {
		const prior = previous.find((item) => item.key === row.key);
		if (prior === undefined) {
			return row;
		}
		return { ...row, tickets: mergeTickets(prior.tickets, row.tickets) };
	});
	options.store.replaceTickets(stored);
	if (failed !== null) {
		options.store.recordFetchError(failed);
	}
	options.notifier.publish({
		overview: overview(options.store),
	});
	return configuration;
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	const notifier = memoryNotifier();
	const clock = { now: options.now ?? (() => new Date()) };
	const configurationPort = {
		read: () => loadConfiguration(options.configPath),
	};
	const trackers = {
		github:
			options.token === null
				? null
				: githubTracker(options.token, options.fetch),
		linear:
			options.linearKey === null
				? null
				: linearTracker(options.linearKey, options.fetch, options.token),
	};
	const pollOptions: PollOptions = {
		configuration: configurationPort,
		...trackers,
		store: opened.store,
		clock,
		notifier,
		token: options.token,
		fetch: options.fetch,
		listTodos: options.listTodos,
		fallback: null,
	};
	const polled = await poll(pollOptions);
	const firstStatus = opened.store.fetchStatus();
	if (
		polled === null ||
		(firstStatus.error !== null && opened.store.readTickets().length === 0)
	) {
		const message = firstStatus.error ?? "poll failed";
		opened.close();
		throw new Error(message);
	}
	let configuration = polled;
	pollOptions.fallback = configuration;
	let polling = false;
	const pollAgain = async (): Promise<void> => {
		if (polling) {
			return;
		}
		polling = true;
		try {
			const next = await poll(pollOptions);
			if (next !== null) {
				configuration = next;
				pollOptions.fallback = configuration;
			}
		} finally {
			polling = false;
		}
	};
	const timer = setInterval(() => {
		void pollAgain();
	}, configuration.pollIntervalSeconds * 1_000);
	const server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		routes: {
			"/": page,
			"/projects/*": page,
			"/api/overview": {
				GET: () => Response.json(overview(opened.store)),
			},
			"/api/events": {
				GET: (request: Request) => {
					server.timeout(request, 0);
					return eventStream(notifier);
				},
			},
			"/api/refresh": {
				POST: async () => {
					await pollAgain();
					return new Response(null, { status: 204 });
				},
			},
		},
	});
	return {
		url: server.url,
		stop: async () => {
			clearInterval(timer);
			await server.stop(true);
			opened.close();
		},
	};
}
