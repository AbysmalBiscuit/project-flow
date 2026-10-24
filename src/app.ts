import { z } from "zod";
import { inboxEntries } from "./attention.ts";
import type { Configuration } from "./configuration.ts";
import {
	loadConfiguration,
	loadFilledConfiguration,
	saveConfiguration,
} from "./configuration.ts";
import { type PostedReply, type ProjectReport, trackers } from "./domain.ts";
import { installationTokenFetch } from "./factory-tokens.ts";
import {
	abortableFetch,
	defaultThreadReadLimitMs,
	type Fetch,
} from "./fetch.ts";
import { conditionalFetch, githubTracker, missingToken } from "./github.ts";
import { elkWorkerPath, forceWorkerPath } from "./graph-layout.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import { attachGraphStates } from "./links.ts";
import { memoryNotifier } from "./notifier.ts";
import { paintPage } from "./page-theme.ts";
import { type PollOptions, poll, runningOverview } from "./poll.ts";
import type { Change, CheckoutSource, Notifier, TodoSource } from "./ports.ts";
import { listedRef } from "./project-ref.ts";
import {
	attentionFor,
	overview,
	projectViewNamed,
	projectViews,
} from "./project-views.ts";
import { recordedReply, replyRequest } from "./replies.ts";
import { filterProjectReport, projectViewFor } from "./report.ts";
import { searchTickets } from "./search.ts";
import {
	mergedSettingsWrite,
	readSettingsWrite,
	rejectUnknownBotKeys,
	sameTracked,
	settingsResponse,
	viewOnlyChange,
} from "./settings-write.ts";
import { sqliteStore } from "./store.ts";
import { storeHoldsRead } from "./stored-page.ts";
import { threadResponse } from "./thread-response.ts";
import { needsYouSeenId } from "./ticket-key.ts";
import { type Trackers, trackerError, trackerFor } from "./tracker-route.ts";

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
	token: string | null;
	linearKey: string | null;
	fetch: Fetch;
	databasePath: string;
	hostname: string;
	port: number;
	listTodos?: TodoSource;
	listCheckouts?: CheckoutSource;
	now?: () => Date;
	threadReadLimitMs?: number;
};

export type Running = {
	url: URL;
	stop: () => Promise<void>;
	readonly settled: Promise<Error | null>;
};

export type { SettingsProject } from "./domain.ts";
export type { TicketSearchHit } from "./ticket-key.ts";

function reportFor(
	options: PollOptions,
	configuration: Configuration,
	name: string,
	filtered: boolean,
): ProjectReport | null {
	const found = projectViewNamed(options, configuration, name);
	if (found === null) {
		return null;
	}
	const [match] = attachGraphStates([
		found.view.report,
		...found.linked.map((item) => item.report),
	]);
	if (match === undefined) {
		return null;
	}
	const view = projectViewFor(configuration, match.name);
	return filtered
		? filterProjectReport(match, view, options.clock.now())
		: match;
}

const replyBody = z.object({
	tracker: z.enum(trackers),
	project: z.string().trim().min(1),
	key: z.string().trim().min(1),
	body: z.string().optional(),
	option: z.number().int().positive().optional(),
	parentId: z.string().optional(),
	kind: z.enum(["comment", "review"]).optional(),
});

const readMarkBody = z.object({ read: z.literal(true) });

const readIdsBody = readMarkBody.extend({
	ids: z.array(z.string()),
});

function invalidConfiguration(error: unknown): Response {
	const message =
		error instanceof Error
			? error.message
			: "invalid configuration: configuration";
	return Response.json({ error: message }, { status: 400 });
}

async function readMark(request: Request): Promise<boolean> {
	const parsed = readMarkBody.safeParse(await request.json().catch(() => null));
	return parsed.success;
}

async function replyResponse(
	trackers: Trackers,
	request: Request,
	options: PollOptions,
	notifier: Notifier,
	configuration: Configuration,
): Promise<Response> {
	const parsed = replyBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: "invalid reply" }, { status: 400 });
	}
	const tracker = trackerFor(trackers, parsed.data.tracker);
	if (tracker?.postReply === undefined) {
		return Response.json({ error: "tracker unavailable" }, { status: 404 });
	}
	const drafted = replyRequest(
		options.store.readTickets(),
		parsed.data,
		configuration.pmBot,
	);
	if ("error" in drafted) {
		return Response.json({ error: drafted.error }, { status: 400 });
	}
	const { reply } = drafted;
	try {
		const created: PostedReply = await tracker.postReply(reply);
		const recorded = recordedReply(options.store.readTickets(), reply, created);
		if (recorded !== undefined) {
			options.store.mergeTickets([recorded]);
		}
		notifier.publish({
			overview: runningOverview(options, configuration),
			notifications: [],
		});
		return Response.json(created, { status: 201 });
	} catch (error) {
		return trackerError(error);
	}
}

function encodeChange(
	encoder: TextEncoder,
	change: Change,
	notifications: boolean,
): Uint8Array[] {
	const frames = [
		encoder.encode(
			`event: ${change.viewsOnly === true ? "views" : "overview"}\ndata: ${JSON.stringify(change.overview)}\n\n`,
		),
	];
	if (change.progress !== undefined) {
		frames.push(
			encoder.encode(
				`event: progress\ndata: ${JSON.stringify(change.progress)}\n\n`,
			),
		);
	}
	if (notifications) {
		for (const notification of change.notifications) {
			frames.push(
				encoder.encode(
					`event: notification\ndata: ${JSON.stringify(notification)}\n\n`,
				),
			);
		}
	}
	return frames;
}

function eventStream(
	notifier: Notifier,
	current: () => Change | null,
): Response {
	let unsubscribe = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(": open\n\n"));
			const open = current();
			if (open !== null) {
				for (const frame of encodeChange(encoder, open, false)) {
					controller.enqueue(frame);
				}
			}
			unsubscribe = notifier.subscribe((change) => {
				for (const frame of encodeChange(encoder, change, true)) {
					controller.enqueue(frame);
				}
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

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	const notifier = memoryNotifier();
	const clock = { now: options.now ?? (() => new Date()) };
	const configurationPort = {
		read: () => loadConfiguration(options.configPath),
		write: (text: string) => saveConfiguration(options.configPath, text),
	};
	const requests = new AbortController();
	const trackerFetch = abortableFetch(options.fetch, requests.signal);
	let configuration: Configuration;
	try {
		configuration = await loadFilledConfiguration(options.configPath);
	} catch (error) {
		opened.close();
		throw error;
	}
	const fetchGithub = installationTokenFetch(
		conditionalFetch(trackerFetch, opened.validators),
		() => ({
			enabled: configuration.factoryGithubTokens,
			dir: configuration.factoryGithubTokenDir,
		}),
		() => clock.now(),
	);
	const trackers = {
		github:
			options.token === null ? null : githubTracker(options.token, fetchGithub),
		linear:
			options.linearKey === null
				? null
				: linearTracker(
						options.linearKey,
						trackerFetch,
						options.token,
						fetchGithub,
					),
	};
	const hadRows = opened.store.readTickets().length > 0;
	const pollOptions: PollOptions = {
		configuration: configurationPort,
		...trackers,
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
		holdLists: Promise.resolve(),
		viewers: [],
		runs: [],
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
	};
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
	let noteDiscovery: () => void = () => {};
	let stopped = false;
	let firstPollDone = false;
	let refreshQueued = false;
	// A poll that started before the last tracked-list write cannot answer for it.
	let trackedGeneration = 0;
	let settledGeneration = -1;
	let awaitingWrite = false;
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
		polling = (async () => {
			if (generation !== trackedGeneration) {
				refreshQueued = true;
				return;
			}
			if (!hadRows && !firstPollDone) {
				pollOptions.polling = true;
			}
			discovery = new Promise<void>((resolve) => {
				noteDiscovery = resolve;
			});
			pollOptions.releaseDiscovery = noteDiscovery;
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
			void firstPoll.finally(beginPoll).catch(() => {});
			return;
		}
		if (polling !== null) {
			refreshQueued = true;
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
		timer = setInterval(() => {
			void pollAgain().catch(() => {});
		}, seconds * 1_000);
		timer.unref?.();
	};
	const armTimer = () => {
		schedule(configuration.pollIntervalSeconds);
	};
	void firstPoll.then(armTimer, armTimer).catch(() => {});
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
			return settingsResponse(
				configuration,
				options,
				pollOptions.catalogue,
				opened.store.readTickets(),
			);
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
		development: false,
		routes: {
			"/_page": page,
			[elkWorkerPath]: () => new Response(Bun.file(elkWorkerFile)),
			[forceWorkerPath]: forceWorker,
			"/": pageResponse,
			"/needs-you": pageResponse,
			"/inbox": pageResponse,
			"/projects/*": pageResponse,
			"/api/overview": {
				GET: () => {
					const body = Response.json(
						runningOverview(pollOptions, configuration),
					);
					setTimeout(releaseLists, 0);
					return body;
				},
			},
			"/api/needs-you": {
				GET: () =>
					Response.json(
						projectViews(pollOptions, configuration).flatMap(
							(item) => item.items,
						),
					),
			},
			"/api/inbox": {
				GET: () =>
					Response.json(
						inboxEntries(opened.store.readNotifications(), clock.now()),
					),
				POST: async (request: Request) => {
					const parsed = readIdsBody.safeParse(
						await request.json().catch(() => null),
					);
					if (!parsed.success) {
						return Response.json(
							{ error: "read must be true" },
							{ status: 400 },
						);
					}
					opened.store.markNotificationsRead(parsed.data.ids);
					return new Response(null, { status: 204 });
				},
			},
			"/api/inbox/:id": {
				POST: async (request) => {
					const marked = await readMark(request);
					if (!marked) {
						return Response.json(
							{ error: "read must be true" },
							{ status: 400 },
						);
					}
					const id = request.params.id.trim();
					if (id === "") {
						return Response.json(
							{ error: "notification id is blank" },
							{ status: 400 },
						);
					}
					if (!opened.store.markNotificationRead(id)) {
						return Response.json(
							{ error: "notification not found" },
							{ status: 404 },
						);
					}
					return new Response(null, { status: 204 });
				},
			},
			"/api/search": {
				GET: (request: Request) => {
					const query = new URL(request.url).searchParams.get("q") ?? "";
					return Response.json(
						searchTickets(projectViews(pollOptions, configuration), query),
					);
				},
			},
			"/api/projects/:name": {
				GET: (request) => {
					const name = request.params.name;
					const filtered =
						new URL(request.url).searchParams.get("view") !== "all";
					const report = reportFor(pollOptions, configuration, name, filtered);
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
				GET: async () => {
					// A read during discovery waits, so a tracked-list write sees this poll's catalogue.
					await discovery;
					return Response.json(
						settingsResponse(
							configuration,
							options,
							pollOptions.catalogue,
							opened.store.readTickets(),
						),
					);
				},
				PUT: async (request: Request) => {
					const rawText = await request.text();
					let parsed: Configuration;
					try {
						parsed = readSettingsWrite(rawText);
					} catch (error) {
						return invalidConfiguration(error);
					}
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
					if (viewOnlyChange(current, merged)) {
						pollOptions.fallback = configuration;
						notifier.publish({
							overview: runningOverview(pollOptions, configuration),
							notifications: [],
							viewsOnly: true,
						});
						return Response.json(
							settingsResponse(
								configuration,
								options,
								pollOptions.catalogue,
								opened.store.readTickets(),
							),
						);
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
						refreshQueued = false;
					} else {
						await (stale ?? pollAgain());
					}
					return Response.json(
						settingsResponse(
							configuration,
							options,
							pollOptions.catalogue,
							opened.store.readTickets(),
						),
					);
				},
			},
			"/api/threads/:tracker/:key": {
				GET: (request) =>
					threadResponse(
						trackers,
						request.params.tracker,
						request.params.key,
						request,
						options.threadReadLimitMs ?? defaultThreadReadLimitMs,
					),
			},
			"/api/replies": {
				POST: (request) =>
					replyResponse(
						trackers,
						request,
						pollOptions,
						notifier,
						configuration,
					),
			},
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
				const everyFailureIsMissingCredential =
					projectErrors.length > 0 &&
					projectErrors.every(
						(error) => error === missingToken || error === missingLinearKey,
					);
				const otherFailure = projectErrors.find(
					(error) =>
						error !== null &&
						error !== missingToken &&
						error !== missingLinearKey,
				);
				const coldError = everyFailureIsMissingCredential
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
			refreshQueued = false;
			requests.abort();
			releaseLists();
			if (timer !== null) {
				clearInterval(timer);
			}
			await (polling ?? Promise.resolve());
			await server.stop(true);
			opened.close();
		},
	};
}
