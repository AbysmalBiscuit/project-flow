import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type { Overview } from "./domain.ts";
import {
	checkoutBasenames,
	checkoutNamesProject,
	githubRepoForTodo,
	linearKeysForNames,
	linearNamesFromCheckouts,
	projectCounts,
	projectSnapshots,
	reconcileSnapshots,
	staleView,
	startedTodoKeys,
	todoRows,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { githubProjectByNumber, githubTracker } from "./github.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import { memoryNotifier } from "./notifier.ts";
import type {
	CheckoutSource,
	Clock,
	ConfigurationPort,
	FoundProject,
	Notifier,
	Store,
	TodoSource,
	Tracker,
	Viewer,
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
	listCheckouts?: CheckoutSource;
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
	const projects = rows.map((row) => {
		const counts = projectCounts(
			row.name,
			row.tracker,
			row.tickets,
			row.pulls,
			row.branches,
			row.startedKeys,
			all,
		);
		const goodPoll = store.lastGoodPollAt(row.key);
		const projectError = store.projectError(row.key);
		const goodAt =
			goodPoll === null || goodPoll.getTime() === 0
				? null
				: goodPoll.toISOString();
		const status = staleView(
			{
				fetchedAt: goodAt,
				error: projectError,
			},
			goodAt,
		);
		return { ...counts, ...status };
	});
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
	listCheckouts?: CheckoutSource | undefined;
	fallback: Configuration | null;
	fullProjects: Set<string>;
};

async function poll(options: PollOptions): Promise<Configuration | null> {
	const polledAt = options.clock.now();
	let configuration: Configuration;
	try {
		configuration = await options.configuration.read();
	} catch (error) {
		const message = error instanceof Error ? error.message : "poll failed";
		options.store.recordFetchError(message);
		if (options.store.readTickets().length > 0) {
			options.notifier.publish({
				overview: overview(options.store),
			});
		}
		return options.fallback;
	}
	const todoListing = (await options.listTodos?.()) ?? "";
	const checkouts = (await options.listCheckouts?.().catch(() => [])) ?? [];
	const startedKeys = startedTodoKeys(
		todoListing,
		checkoutBasenames(checkouts),
	);
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
	let githubPage: { projects: FoundProject[]; viewer: Viewer | null } = {
		projects: [],
		viewer: null,
	};
	let failed: string | null = null;
	if (github !== null) {
		try {
			githubPage = await github.findProjects();
		} catch (error) {
			failed = error instanceof Error ? error.message : "poll failed";
		}
	}
	const discovered = [...githubPage.projects];
	if (linear !== null) {
		mergeFound(discovered, (await linear.findProjects()).projects);
	}
	const viewer = githubPage.viewer;
	const named = new Set<string>();
	for (const checkout of checkouts) {
		if (checkout.tracker !== "github" || checkout.repo.trim() === "") {
			continue;
		}
		if (
			!checkoutNamesProject(
				checkout.hasTrackerConfig,
				checkout.originOwner,
				viewer,
			)
		) {
			continue;
		}
		named.add(checkout.repo.trim().toLowerCase());
		mergeFound(discovered, [
			{ key: checkout.repo.trim(), tracker: "github", updatedAt: null },
		]);
	}
	const rows = todoRows(todoListing);
	for (const row of rows) {
		const repo = githubRepoForTodo(row.project, checkoutBasenames(checkouts));
		if (repo === null || named.has(repo.toLowerCase())) {
			continue;
		}
		named.add(repo.toLowerCase());
		mergeFound(discovered, [{ key: repo, tracker: "github", updatedAt: null }]);
	}
	if (linear !== null) {
		const keys = linearKeysForNames(linearNamesFromCheckouts(checkouts, rows));
		mergeFound(discovered, (await linear.projectsForKeys?.(keys)) ?? []);
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
	const fullPoll = new Set<string>();
	const listed = [];
	for (const project of found) {
		const tracker = project.tracker === "github" ? github : linear;
		if (tracker === null) {
			throw new Error(missingLinearKey);
		}
		const lastGood = options.store.lastGoodPollAt(project.key);
		const full =
			project.tracker === "linear" &&
			(lastGood === null || options.fullProjects.has(project.key));
		const since = full ? null : lastGood;
		if (full && project.tracker === "linear") {
			fullPoll.add(project.key);
		}
		try {
			const listedTickets = await tracker.listTickets(project.key, since, full);
			const pulls = await tracker.listPulls(project.key, since);
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
			options.store.clearProjectError(project.key);
			if (full) {
				options.fullProjects.delete(project.key);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "poll failed";
			failed = message;
			options.store.recordProjectError(project.key, message);
			const stored = options.store
				.readTickets()
				.find((row) => row.key === project.key);
			if (stored === undefined && listed.length === 0) {
				continue;
			}
			listed.push({
				...project,
				name: project.name ?? stored?.name ?? project.key,
				tickets: stored?.tickets ?? [],
				pulls: stored?.pulls ?? [],
				branches: stored?.branches ?? [],
				startedKeys,
				pinned: pinnedKeys.has(project.key),
				hidden: hiddenKeys.has(project.key),
				...(project.closed === undefined ? {} : { closed: project.closed }),
			});
		}
	}
	const shown = projectSnapshots(
		listed,
		polledAt,
		configuration.activityWindowDays,
	);
	const stored = reconcileSnapshots(
		options.store.readTickets(),
		shown,
		found.map((project) => project.key),
		[...fullPoll],
		failed !== null,
	);
	options.store.replaceTickets(stored);
	if (failed !== null) {
		const failedProject = found.find(
			(project) => options.store.projectError(project.key) !== null,
		);
		const hasCard =
			failedProject !== undefined &&
			stored.some((row) => row.key === failedProject.key);
		if (!hasCard) {
			options.store.recordFetchError(failed);
		}
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
	let configuration: Configuration;
	try {
		configuration = await configurationPort.read();
	} catch (error) {
		opened.close();
		throw error;
	}
	const pollOptions: PollOptions = {
		configuration: configurationPort,
		...trackers,
		store: opened.store,
		clock,
		notifier,
		token: options.token,
		fetch: options.fetch,
		listTodos: options.listTodos,
		listCheckouts: options.listCheckouts,
		fallback: configuration,
		fullProjects: new Set(),
	};
	let polling: Promise<void> | null = null;
	let stopped = false;
	const pollAgain = (): Promise<void> => {
		if (stopped) {
			return Promise.resolve();
		}
		if (polling !== null) {
			return polling;
		}
		polling = (async () => {
			try {
				const next = await poll(pollOptions);
				if (next !== null) {
					configuration = next;
					pollOptions.fallback = configuration;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "poll failed";
				opened.store.recordFetchError(message);
				if (opened.store.readTickets().length === 0) {
					throw error;
				}
				notifier.publish({ overview: overview(opened.store) });
			}
		})().finally(() => {
			polling = null;
		});
		return polling;
	};
	if (opened.store.readTickets().length === 0) {
		try {
			await pollAgain();
		} catch (error) {
			opened.close();
			throw error;
		}
		const firstStatus = opened.store.fetchStatus();
		if (firstStatus.error !== null && opened.store.readTickets().length === 0) {
			opened.close();
			throw new Error(firstStatus.error);
		}
	}
	const markFull = (): void => {
		for (const pin of configuration.pinned) {
			if (pin.tracker === "linear") {
				pollOptions.fullProjects.add(pin.project);
			}
		}
		for (const row of opened.store.readTickets()) {
			if (row.tracker === "linear") {
				pollOptions.fullProjects.add(row.key);
			}
		}
	};
	const timer = setInterval(() => {
		markFull();
		void pollAgain();
	}, configuration.pollIntervalSeconds * 1_000);
	timer.unref?.();
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
	if (opened.store.readTickets().length > 0) {
		setTimeout(() => {
			void pollAgain();
		}, 0);
	}
	return {
		url: server.url,
		stop: async () => {
			stopped = true;
			clearInterval(timer);
			await (polling ?? Promise.resolve());
			await server.stop(true);
			opened.close();
		},
	};
}
