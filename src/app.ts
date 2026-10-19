import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type {
	Overview,
	ProjectPoll,
	ProjectReport,
	Snapshot,
} from "./domain.ts";
import {
	checkoutBasenames,
	checkoutNamesProject,
	githubRepoForTodo,
	linearKeysForNames,
	linearNamesFromCheckouts,
	projectCounts,
	projectReport,
	projectSnapshots,
	reconcilePoll,
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

const fullPollPeriodMs = 10 * 60 * 1000;

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

function counted(store: Store) {
	const rows = store.readTickets();
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	return rows.map((row) => {
		const goodPoll = store.lastGoodPollAt(row.key);
		return {
			row,
			counts: projectCounts(
				row.name,
				row.tracker,
				row.tickets,
				row.pulls,
				row.branches,
				row.startedKeys,
				all,
				{
					fetchedAt: goodPoll?.toISOString() ?? null,
					error: store.projectError(row.key),
				},
			),
		};
	});
}

function overview(store: Store): Overview {
	const projects = counted(store).map((item) => item.counts);
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

function reportFor(store: Store, name: string): ProjectReport | null {
	const match = counted(store).find(
		(item) => item.counts.name.toLowerCase() === name.toLowerCase(),
	);
	if (match === undefined) {
		return null;
	}
	return projectReport(match.counts, match.row.tickets);
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
	fullPoll: Set<string>;
	lastFullPollAt: Map<string, number>;
	holdLists: Promise<void>;
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
	const listed = [];
	const outcomes = new Map<string, ProjectPoll>();
	for (const project of found) {
		const tracker = project.tracker === "github" ? github : linear;
		if (tracker === null) {
			throw new Error(missingLinearKey);
		}
		const lastGood = options.store.lastGoodPollAt(project.key);
		const lastFull = options.lastFullPollAt.get(project.key) ?? null;
		const full =
			lastGood === null ||
			(project.tracker === "linear" &&
				(lastFull === null ||
					polledAt.getTime() - lastFull >= fullPollPeriodMs));
		if (full) {
			options.fullPoll.add(project.key);
		}
		const since = full ? null : lastGood;
		const pinned = pinnedKeys.has(project.key);
		const hidden = hiddenKeys.has(project.key);
		try {
			await options.holdLists;
			const listedTickets = await tracker.listTickets(project.key, since);
			const pulls = await tracker.listPulls(
				project.key,
				project.tracker === "linear" ? since : null,
			);
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
				pinned,
				hidden,
				...(project.closed === undefined ? {} : { closed: project.closed }),
			});
			outcomes.set(project.key, {
				key: project.key,
				ok: true,
				error: null,
				full,
				pinned,
				hidden,
				row: null,
			});
			options.store.recordGoodPoll(project.key, polledAt);
			options.store.clearProjectError(project.key);
		} catch (error) {
			const message = error instanceof Error ? error.message : "poll failed";
			const stored = options.store
				.readTickets()
				.find((row) => row.key === project.key);
			const empty: Snapshot = {
				key: project.key,
				name: project.name ?? stored?.name ?? project.key,
				tracker: project.tracker,
				tickets: [],
				pulls: [],
				branches: [],
				startedKeys,
			};
			outcomes.set(project.key, {
				key: project.key,
				ok: false,
				error: message,
				full,
				pinned,
				hidden,
				row: stored ?? empty,
			});
		}
	}
	const shown = projectSnapshots(
		listed,
		polledAt,
		configuration.activityWindowDays,
	);
	for (const row of shown) {
		const outcome = outcomes.get(row.key);
		if (outcome?.ok === true) {
			outcome.row = row;
		}
	}
	const reconciled = reconcilePoll(
		options.store.readTickets(),
		[...outcomes.values()],
		[...options.fullPoll],
	);
	for (const key of [...options.fullPoll]) {
		if (outcomes.get(key)?.ok === true) {
			options.fullPoll.delete(key);
			options.lastFullPollAt.set(key, polledAt.getTime());
		}
	}
	options.store.replaceTickets(reconciled.rows);
	for (const projectError of reconciled.projectErrors) {
		options.store.recordProjectError(projectError.key, projectError.error);
	}
	if (reconciled.globalError !== null) {
		options.store.recordFetchError(reconciled.globalError);
	} else if (failed !== null) {
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
		fullPoll: new Set(),
		lastFullPollAt: new Map(),
		holdLists: Promise.resolve(),
	};
	let releaseLists = () => {};
	const hadRows = opened.store.readTickets().length > 0;
	if (hadRows) {
		let released = false;
		pollOptions.holdLists = new Promise<void>((resolve) => {
			releaseLists = () => {
				if (released) {
					return;
				}
				released = true;
				resolve();
			};
		});
		// A listen callback reads stored rows before this poll lists tickets.
		const fallback = setTimeout(releaseLists, 1_000);
		fallback.unref?.();
	}
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
				if (stopped) {
					return;
				}
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
	if (!hadRows) {
		try {
			await pollAgain();
		} catch (error) {
			stopped = true;
			await (polling ?? Promise.resolve());
			opened.close();
			throw error;
		}
		const firstStatus = opened.store.fetchStatus();
		const rows = opened.store.readTickets();
		const fetched = rows.filter(
			(row) => opened.store.projectError(row.key) === null,
		);
		const coldError =
			firstStatus.error ??
			(rows[0] === undefined ? null : opened.store.projectError(rows[0].key));
		if (fetched.length === 0 && coldError !== null) {
			stopped = true;
			await (polling ?? Promise.resolve());
			opened.close();
			throw new Error(coldError);
		}
	}
	const timer = setInterval(() => {
		void pollAgain();
	}, configuration.pollIntervalSeconds * 1_000);
	timer.unref?.();
	const server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		development: false,
		routes: {
			"/": page,
			"/projects/*": page,
			"/api/overview": {
				GET: () => {
					const body = Response.json(overview(opened.store));
					releaseLists();
					return body;
				},
			},
			"/api/projects/:name": {
				GET: (request) => {
					const name = request.params.name;
					const report = reportFor(opened.store, name);
					if (report === null) {
						return Response.json(
							{ error: "project not found" },
							{ status: 404 },
						);
					}
					return Response.json(report);
				},
			},
			"/api/events": {
				GET: (request: Request) => {
					server.timeout(request, 0);
					return eventStream(notifier);
				},
			},
			"/api/refresh": {
				POST: async () => {
					releaseLists();
					await pollAgain();
					return new Response(null, { status: 204 });
				},
			},
		},
	});
	if (hadRows) {
		setTimeout(() => {
			void pollAgain();
		}, 0);
	}
	return {
		url: server.url,
		stop: async () => {
			stopped = true;
			releaseLists();
			clearInterval(timer);
			await (polling ?? Promise.resolve());
			await server.stop(true);
			opened.close();
		},
	};
}
