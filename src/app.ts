import {
	buildBackends,
	type Credentials,
	type Env,
	type FactoryTokenMint,
	prepareRepoFetch,
} from "./backends.ts";
import type { Configuration, Factory } from "./configuration.ts";
import {
	loadConfiguration,
	loadFilledConfiguration,
	saveConfiguration,
} from "./configuration.ts";
import { eventStream } from "./event-stream.ts";
import { factoryReader } from "./factories.ts";
import { factoryRunRoutes } from "./factory-run-routes.ts";
import {
	abortableFetch,
	defaultTrackerRequestLimitMs,
	type Fetch,
} from "./fetch.ts";
import { elkWorkerPath } from "./graph-core.ts";
import { forceWorkerPath } from "./graph-layout.ts";
import { inboxEntries } from "./inbox-entries.ts";
import { inboxRoutes } from "./inbox-routes.ts";
import page from "./index.html";
import { memoryNotifier } from "./notifier.ts";
import { paintPage } from "./page-theme.ts";
import { poll, type PollOptions, runningOverview } from "./poll.ts";
import type { CheckoutSource, TodoSource } from "./ports.ts";
import { listedRef } from "./project-ref.ts";
import { projectRoutes, reportFor } from "./project-routes.ts";
import { attentionFor, overview, projectViews } from "./project-views.ts";
import { pullRoutes } from "./pull-routes.ts";
import { replyRoutes } from "./reply-routes.ts";
import { runStartRoutes } from "./run-start-routes.ts";
import { settledRequests } from "./run-start.ts";
import {
	mergedSettingsWrite,
	readSettingsWrite,
	rejectUnknownBotKeys,
	sameTracked,
	settingsResponse,
	viewOnlyChange,
} from "./settings-write.ts";
import { staleReads } from "./stale-reads.ts";
import { sqliteStore } from "./store.ts";
import { storeHoldsRead } from "./stored-page.ts";
import { needsYouSeenId } from "./ticket-key.ts";
import { projectTrackers } from "./tracker-route.ts";

const elkWorkerFile = Bun.resolveSync(
	"elkjs/lib/elk-worker.min.js",
	import.meta.dir,
);

let forceWorkerScript: Promise<string> | undefined;

/** Bundles the Force layout worker on its first request. */
async function forceWorker(): Promise<Response> {
	forceWorkerScript ??= Bun.build({
		entrypoints: [Bun.resolveSync("./graph-force-worker.ts", import.meta.dir)],
		target: "browser",
		minify: true,
	}).then(async (built) => {
		const [script] = built.outputs;
		if (script === undefined) {
			throw new Error("the Force layout worker did not bundle");
		}
		return script.text();
	});
	return new Response(await forceWorkerScript, {
		headers: { "content-type": "text/javascript" },
	});
}

export type StartOptions = {
	configPath: string;
	credentials: Credentials;
	env: Env;
	fetch: Fetch;
	databasePath: string;
	hostname: string;
	port: number;
	listTodos?: TodoSource;
	listCheckouts?: CheckoutSource;
	now?: () => Date;
	threadReadLimitMs?: number;
	trackerRequestLimitMs?: number;
	/** How long one second of `pollIntervalSeconds` lasts on the poll timer. */
	intervalSecondMs?: number;
	/** How often the run poll checks the clock and follows the factory event streams. */
	runTickMs?: number;
	/** Bun's idle timeout for a connection, in whole seconds. */
	idleTimeoutSeconds?: number;
	mintFactoryTokens?: FactoryTokenMint;
	mintRetryDelayMs?: number;
	/** The `--factory` list, which replaces the configured factories. */
	flagFactories?: Factory[];
};

export type Running = {
	url: URL;
	stop: () => Promise<void>;
	readonly settled: Promise<Error | null>;
};

export type { SettingsProject } from "./domain.ts";
export type { TicketSearchHit } from "./ticket-key.ts";

const runPollMs = 10_000;

const defaultRunTickMs = 500;

function invalidConfiguration(error: unknown): Response {
	const message =
		error instanceof Error
			? error.message
			: "invalid configuration: configuration";
	return Response.json({ error: message }, { status: 400 });
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	const notifier = memoryNotifier();
	const clock = { now: options.now ?? (() => new Date()) };
	const configurationPort = {
		read: () => loadConfiguration(options.configPath),
		write: (text: string) => saveConfiguration(options.configPath, text),
	};
	const requests = new AbortController();
	const trackerFetch = abortableFetch(
		options.fetch,
		requests.signal,
		options.trackerRequestLimitMs ?? defaultTrackerRequestLimitMs,
	);
	let configuration: Configuration;
	try {
		configuration = await loadFilledConfiguration(options.configPath);
	} catch (error) {
		opened.close();
		throw error;
	}
	const repoFetch = prepareRepoFetch(trackerFetch, {
		validators: opened.validators,
		configuration: () => configuration,
		now: () => clock.now(),
		mint: options.mintFactoryTokens,
		mintRetryDelayMs: options.mintRetryDelayMs,
	});
	void repoFetch.mintNow();
	const flagFactories = options.flagFactories ?? [];
	const listedFactories = () =>
		flagFactories.length > 0
			? flagFactories.map((factory) => ({
					...factory,
					source: "flag" as const,
				}))
			: configuration.factories.map((factory) => ({
					...factory,
					source: "config" as const,
				}));
	const factories = factoryReader(
		options.fetch,
		listedFactories,
		requests.signal,
		() => clock.now(),
	);
	const backends = buildBackends({
		credentials: options.credentials,
		env: options.env,
		fetch: trackerFetch,
		repoFetch: repoFetch.fetch,
	});
	const trackerOf = projectTrackers(
		backends,
		() => opened.store.readTickets(),
		() => configuration.hosts,
	);
	const hadRows = opened.store.readTickets().length > 0;
	const pollOptions: PollOptions = {
		configuration: configurationPort,
		backends,
		store: opened.store,
		clock,
		notifier,
		listTodos: options.listTodos,
		listCheckouts: options.listCheckouts,
		releaseDiscovery: () => {},
		mayPublish: () => true,
		fallback: configuration,
		fullPoll: new Set(),
		lastFullPollAt: new Map(),
		projectReads: { count: 0, newest: new Map() },
		holdLists: Promise.resolve(),
		viewers: [],
		runs: [],
		factoryRuns: factories.runs,
		listedFactories,
		linearSources: factories.linearSources,
		runStartRequests: new Map(),
		workcellAuto: {},
		repoAutoMerge: {},
		attention: {
			needsYou: [],
			comments: new Map(),
			blockers: new Map(),
			closed: new Set(),
			closedBlockers: new Set(),
		},
		seenNotifications: new Set([
			...opened.store
				.readNotifications()
				.filter((entry) => entry.trigger !== "needsYou")
				.map((entry) => entry.id),
			...opened.store.readSeededIds(),
		]),
		primed: hadRows,
		polling: false,
		progress: null,
		stopped: false,
		catalogue: [],
		factoryUnreachable: factories.unreachable,
	};
	const settingsBody = () =>
		settingsResponse(
			configuration,
			backends.views,
			pollOptions.catalogue,
			opened.store.readTickets(),
			repoFetch.reports(),
			factories.entries(),
			discovering,
		);
	if (pollOptions.primed) {
		pollOptions.attention = attentionFor(pollOptions, configuration);
		const kept = pollOptions.attention.needsYou.map(needsYouSeenId);
		for (const id of kept) {
			pollOptions.seenNotifications.add(id);
		}
		opened.store.recordSeededIds(kept);
	}
	let listsHeld = false;
	let releaseLists = () => {};
	if (hadRows) {
		listsHeld = true;
		pollOptions.holdLists = new Promise<void>((resolve) => {
			releaseLists = () => {
				if (!listsHeld) {
					return;
				}
				listsHeld = false;
				resolve();
			};
		});
	}
	let polling: Promise<void> | null = null;
	let discovery: Promise<void> = Promise.resolve();
	// A refresh queued behind a running poll holds settings writes until the
	// next poll's discovery, so they never check against the older catalogue.
	let queuedDiscovery: (() => void) | null = null;
	let discovering = false;
	const nextDiscovery = (): (() => void) => {
		let note = () => {};
		const next = new Promise<void>((resolve) => {
			note = resolve;
		});
		discovery = next;
		discovering = true;
		void next.then(() => {
			if (discovery === next) {
				discovering = false;
			}
		});
		return note;
	};
	let stopped = false;
	const factoryState = () =>
		JSON.stringify([
			factories.unreachable(),
			factories.entries(),
			factories.linearSources(),
			factories.runs(),
		]);
	const publishOverview = () => {
		if (!stopped) {
			notifier.publish({
				overview: runningOverview(pollOptions, configuration),
				notifications: [],
			});
		}
	};
	const readFactories = async (read: () => Promise<void>) => {
		const before = factoryState();
		await read();
		const requests = pollOptions.runStartRequests;
		pollOptions.runStartRequests = settledRequests(
			requests,
			factories.runs(),
			factories.entries(),
		);
		if (
			factoryState() !== before ||
			pollOptions.runStartRequests !== requests
		) {
			publishOverview();
		}
	};
	const staleRead = staleReads(publishOverview);
	const readKey = (request: Request) => {
		const url = new URL(request.url);
		return url.pathname + url.search;
	};
	const checkFactories = () => {
		void readFactories(factories.check).catch(() => {});
	};
	let firstPollDone = false;
	let refreshQueued = false;
	// A poll that started before the last tracked-list write cannot answer for it.
	let trackedGeneration = 0;
	let settledGeneration = -1;
	let awaitingWrite = false;
	const dropQueuedRefresh = () => {
		refreshQueued = false;
		queuedDiscovery?.();
		queuedDiscovery = null;
	};
	const pollAgain = (): Promise<void> => {
		if (stopped || pollOptions.stopped) {
			return Promise.resolve();
		}
		if (polling !== null) {
			return polling;
		}
		let rejected = false;
		const generation = trackedGeneration;
		pollOptions.mayPublish = () => generation === trackedGeneration;
		const noteDiscovery = queuedDiscovery ?? nextDiscovery();
		queuedDiscovery = null;
		pollOptions.releaseDiscovery = noteDiscovery;
		checkFactories();
		polling = (async () => {
			if (generation !== trackedGeneration) {
				refreshQueued = true;
				return;
			}
			if (!hadRows && !firstPollDone) {
				pollOptions.polling = true;
			}
			try {
				configuration = await poll(pollOptions);
				if (generation !== trackedGeneration) {
					refreshQueued = true;
				}
			} catch (error) {
				if (
					stopped ||
					pollOptions.stopped ||
					generation !== trackedGeneration
				) {
					return;
				}
				rejected = true;
				const message = error instanceof Error ? error.message : "poll failed";
				opened.store.recordFetchError(message);
				if (opened.store.readTickets().length === 0) {
					throw error;
				}
			}
		})().finally(async () => {
			noteDiscovery();
			settledGeneration = Math.max(settledGeneration, generation);
			polling = null;
			if (!stopped && refreshQueued && !awaitingWrite) {
				refreshQueued = false;
				pollOptions.polling = true;
				await pollAgain().catch(() => {});
				return;
			}
			pollOptions.polling = false;
			if (stopped) {
				return;
			}
			// A successful poll already published. Publish here only after a
			// rejection, so an empty store still ends the running state.
			if (rejected) {
				const failed = pollOptions.progress;
				pollOptions.progress =
					failed === null ? null : { ...failed, ended: true };
				notifier.publish({
					overview: overview(pollOptions, configuration),
					notifications: [],
					...(pollOptions.progress === null
						? {}
						: { progress: pollOptions.progress }),
				});
				pollOptions.progress = null;
			}
			// A cold failure stops the process on the next turn. Yield so the
			// settled overview leaves the event stream first.
			if (rejected && !firstPollDone) {
				await Bun.sleep(0);
			}
		});
		return polling;
	};
	const beginPoll = (): void => {
		pollOptions.polling = true;
		releaseLists();
		notifier.publish({
			overview: runningOverview(pollOptions, configuration),
			notifications: [],
		});
		// The cold-start check judges the first poll alone, so a refresh
		// waits for it instead of joining its chain.
		if (!firstPollDone) {
			queuedDiscovery ??= nextDiscovery();
			void firstPoll.finally(beginPoll).catch(() => {});
			return;
		}
		if (polling !== null) {
			refreshQueued = true;
			queuedDiscovery ??= nextDiscovery();
			return;
		}
		void pollAgain().catch(() => {});
	};
	const firstPoll = pollAgain().finally(() => {
		firstPollDone = true;
	});
	let timer: ReturnType<typeof setInterval> | null = null;
	const schedule = (seconds: number) => {
		if (stopped) {
			return;
		}
		if (timer !== null) {
			clearInterval(timer);
		}
		timer = setInterval(
			() => {
				void pollAgain().catch(() => {});
			},
			seconds * (options.intervalSecondMs ?? 1_000),
		);
		timer.unref?.();
	};
	const armTimer = () => {
		schedule(configuration.pollIntervalSeconds);
	};
	void firstPoll.then(armTimer, armTimer).catch(() => {});
	// The run poll checks the clock port each tick, so a test that advances
	// the clock past the run poll interval gets the next read.
	let runsReadAt: number | null = null;
	let readingRuns = false;
	const pollRuns = () => {
		if (stopped || listedFactories().length === 0) {
			return;
		}
		factories.follow(
			() => clock.now().getTime(),
			(change) => readFactories(change).catch(() => {}),
		);
		if (readingRuns) {
			return;
		}
		const now = clock.now().getTime();
		if (runsReadAt !== null && now - runsReadAt < runPollMs) {
			return;
		}
		runsReadAt = now;
		readingRuns = true;
		void readFactories(() => factories.readRuns(now))
			.catch(() => {})
			.finally(() => {
				readingRuns = false;
			});
	};
	const runTimer = setInterval(pollRuns, options.runTickMs ?? defaultRunTickMs);
	runTimer.unref?.();
	pollRuns();
	let server: ReturnType<typeof Bun.serve>;
	const pageResponse = async (request: Request): Promise<Response> => {
		const bundled = await fetch(new URL("/_page", server.url));
		const html = paintPage(
			await bundled.text(),
			configuration,
			storedForPage(new URL(request.url).pathname),
			pollOptions.polling,
		);
		const headers = new Headers(bundled.headers);
		headers.delete("content-length");
		return new Response(html, { status: bundled.status, headers });
	};
	const storedForPage = (pathname: string): unknown => {
		const projectPrefix = "/projects/";
		if (pathname.startsWith(projectPrefix)) {
			let name: string;
			try {
				name = decodeURIComponent(pathname.slice(projectPrefix.length));
			} catch {
				return undefined;
			}
			return reportFor(pollOptions, configuration, name, false) ?? undefined;
		}
		if (pathname === "/needs-you") {
			const body = runningOverview(pollOptions, configuration);
			if (!storeHoldsRead(body)) {
				return undefined;
			}
			return projectViews(pollOptions, configuration).flatMap(
				(item) => item.items,
			);
		}
		if (pathname === "/inbox") {
			const body = runningOverview(pollOptions, configuration);
			if (!storeHoldsRead(body)) {
				return undefined;
			}
			return inboxEntries(opened.store.readNotifications(), clock.now());
		}
		if (pathname === "/settings") {
			return settingsBody();
		}
		if (pathname === "/runs" || pathname.startsWith("/runs/")) {
			return undefined;
		}
		const body = runningOverview(pollOptions, configuration);
		if (!storeHoldsRead(body)) {
			return undefined;
		}
		return {
			overview: body,
			settings: configuration,
		};
	};
	server = Bun.serve({
		hostname: options.hostname,
		port: options.port,
		...(options.idleTimeoutSeconds === undefined
			? {}
			: { idleTimeout: options.idleTimeoutSeconds }),
		development: false,
		routes: {
			"/_page": page,
			[elkWorkerPath]: () => new Response(Bun.file(elkWorkerFile)),
			[forceWorkerPath]: forceWorker,
			"/": pageResponse,
			"/needs-you": pageResponse,
			"/inbox": pageResponse,
			"/projects/*": pageResponse,
			"/runs": pageResponse,
			"/runs/*": pageResponse,
			"/api/overview": {
				GET: () => {
					const body = Response.json(
						runningOverview(pollOptions, configuration),
					);
					setTimeout(releaseLists, 0);
					return body;
				},
			},
			"/api/events": {
				GET: (request: Request) => {
					server.timeout(request, 0);
					return eventStream(notifier, () =>
						pollOptions.progress === null
							? null
							: {
									overview: runningOverview(pollOptions, configuration),
									notifications: [],
									progress: pollOptions.progress,
								},
					);
				},
			},
			"/api/refresh": {
				POST: () => {
					queueMicrotask(beginPoll);
					return new Response(null, { status: 204 });
				},
			},
			"/settings": pageResponse,
			"/api/settings": {
				GET: () => Response.json(settingsBody()),
				PUT: async (request: Request) => {
					const rawText = await request.text();
					let parsed: Configuration;
					try {
						parsed = readSettingsWrite(rawText);
					} catch (error) {
						return invalidConfiguration(error);
					}
					// The bot key check and a tracked-list write need this poll's catalogue.
					await discovery;
					const current = await configurationPort.read();
					const unknownBot = rejectUnknownBotKeys(
						parsed,
						current,
						opened.store.readTickets(),
						pollOptions.catalogue,
					);
					if (unknownBot !== null) {
						return Response.json({ error: unknownBot }, { status: 400 });
					}
					const merged = mergedSettingsWrite(current, parsed, rawText);
					const mergedText = JSON.stringify(merged);
					const trackedChanged = !sameTracked(current.tracked, merged.tracked);
					const stale = polling;
					try {
						configuration = await configurationPort.write(mergedText);
					} catch (error) {
						return invalidConfiguration(error);
					}
					if (
						!current.factoryGithubTokens &&
						configuration.factoryGithubTokens
					) {
						void repoFetch.mintNow();
					}
					if (viewOnlyChange(current, merged)) {
						pollOptions.fallback = configuration;
						notifier.publish({
							overview: runningOverview(pollOptions, configuration),
							notifications: [],
							viewsOnly: true,
						});
						return Response.json(settingsBody());
					}
					if (trackedChanged) {
						trackedGeneration += 1;
					}
					configuration = await configurationPort.read();
					pollOptions.fallback = configuration;
					schedule(configuration.pollIntervalSeconds);
					releaseLists();
					if (trackedChanged) {
						const written = trackedGeneration;
						awaitingWrite = true;
						try {
							while (
								settledGeneration < written &&
								!stopped &&
								!pollOptions.stopped
							) {
								await pollAgain();
							}
						} finally {
							awaitingWrite = false;
						}
						dropQueuedRefresh();
					} else {
						await (stale ?? pollAgain());
					}
					await readFactories(factories.settled);
					return Response.json(settingsBody());
				},
			},
			...projectRoutes(pollOptions, () => configuration),
			...pullRoutes(pollOptions, () => configuration),
			...inboxRoutes(opened.store, clock),
			...replyRoutes({
				trackerOf,
				pollOptions,
				notifier,
				configuration: () => configuration,
				staleRead,
				readKey,
				threadReadLimitMs: options.threadReadLimitMs,
			}),
			...runStartRoutes({
				trackerOf,
				pollOptions,
				notifier,
				configuration: () => configuration,
				factories,
				clock,
				readFactories,
			}),
			...factoryRunRoutes({
				factories,
				pollOptions,
				configuration: () => configuration,
				clock,
				staleRead,
				readKey,
				readFactories,
				publishOverview,
			}),
		},
	});
	if (hadRows) {
		setTimeout(releaseLists, 5_000).unref?.();
	}
	const cold = !hadRows;
	let settle: (error: Error | null) => void = () => {};
	const settled = new Promise<Error | null>((resolve) => {
		settle = resolve;
	});
	if (cold) {
		void firstPoll.then(
			() => {
				const firstStatus = opened.store.fetchStatus();
				const rows = opened.store.readTickets();
				const fetched = rows.filter(
					(row) => opened.store.projectError(listedRef(row)) === null,
				);
				const projectErrors = rows.map((row) =>
					opened.store.projectError(listedRef(row)),
				);
				const everyFailureIsExplained =
					projectErrors.length > 0 &&
					projectErrors.every(
						(error) => error !== null && backends.explains(error),
					);
				const otherFailure = projectErrors.find(
					(error) => error !== null && !backends.explains(error),
				);
				const coldError = everyFailureIsExplained
					? null
					: (firstStatus.error ?? otherFailure ?? null);
				if (fetched.length === 0 && coldError !== null && !stopped) {
					settle(new Error(coldError));
					return;
				}
				settle(null);
			},
			(error: unknown) => {
				if (stopped) {
					settle(null);
					return;
				}
				settle(error instanceof Error ? error : new Error("poll failed"));
			},
		);
	} else {
		settle(null);
	}
	return {
		url: server.url,
		settled,
		stop: async () => {
			stopped = true;
			pollOptions.stopped = true;
			dropQueuedRefresh();
			requests.abort();
			repoFetch.stop();
			releaseLists();
			if (timer !== null) {
				clearInterval(timer);
			}
			clearInterval(runTimer);
			await (polling ?? Promise.resolve());
			await server.stop(true);
			opened.close();
		},
	};
}
