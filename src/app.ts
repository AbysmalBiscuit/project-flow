import { z } from "zod";
import type { Configuration } from "./configuration.ts";
import { loadConfiguration } from "./configuration.ts";
import type {
	Attention,
	Comment,
	Overview,
	PostedReply,
	ProjectPoll,
	ProjectReport,
	ReplyRequest,
	Snapshot,
	Thread,
} from "./domain.ts";
import {
	attentionOf,
	checkoutBasenames,
	checkoutNamesProject,
	commentTree,
	expectedBotsByRepo,
	githubRepoForTodo,
	linearKeysForNames,
	linearNamesFromCheckouts,
	notificationsFor,
	panelReplyBody,
	primeAttention,
	projectCounts,
	projectHasNoSenior,
	projectSnapshots,
	reconcilePoll,
	staleView,
	startedTodoKeys,
	todoRows,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	githubProjectByNumber,
	githubTicketKey,
	githubTracker,
	missingToken,
} from "./github.ts";
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

function viewerLogins(
	configuration: Configuration,
	viewers: Viewer[],
): string[] {
	const found = viewers.flatMap((viewer) => {
		const names = viewer.login.trim() === "" ? [] : [viewer.login];
		return viewer.id === undefined || viewer.id.trim() === ""
			? names
			: [...names, viewer.id];
	});
	const override = configuration.viewerLogins.filter(
		(login) => login.trim() !== "",
	);
	return override.length === 0 ? found : [...override, ...found];
}

function needsYouRules(configuration: Configuration, viewers: Viewer[]) {
	return {
		noSenior: configuration.noSenior,
		labels: configuration.needsYouLabels,
		viewerLogins: viewerLogins(configuration, viewers),
	};
}

function projectViews(
	store: Store,
	configuration: Configuration,
	viewers: Viewer[],
) {
	const rows = store.readTickets();
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	return rows.map((row) => {
		const goodPoll = store.lastGoodPollAt(row.key);
		const counted = projectCounts(
			row.name,
			row.key,
			row.tracker,
			row.tickets,
			row.pulls,
			row.branches,
			row.startedKeys,
			all,
			expectedBotsByRepo(row.pulls, configuration.expectedBots ?? {}),
			{
				fetchedAt: goodPoll?.toISOString() ?? null,
				error: store.projectError(row.key),
			},
			needsYouRules(configuration, viewers),
		);
		return {
			row,
			items: counted.needsYou,
			counts: counted.counts,
			report: counted.report,
		};
	});
}

function overview(
	store: Store,
	configuration: Configuration,
	viewers: Viewer[],
): Overview {
	const projects = projectViews(store, configuration, viewers).map(
		(item) => item.counts,
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

function reportFor(
	store: Store,
	configuration: Configuration,
	viewers: Viewer[],
	name: string,
): ProjectReport | null {
	const match = projectViews(store, configuration, viewers).find(
		(item) => item.counts.name.toLowerCase() === name.toLowerCase(),
	);
	if (match === undefined) {
		return null;
	}
	return match.report;
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

const replyBody = z.object({
	tracker: z.enum(["github", "linear"]),
	project: z.string().trim().min(1),
	key: z.string().trim().min(1),
	body: z.string(),
	parentId: z.string().optional(),
	kind: z.enum(["comment", "review"]).optional(),
});

type Trackers = Pick<PollOptions, "github" | "linear">;

function trackerFor(trackers: Trackers, name: string): Tracker | null {
	if (name === "github") {
		return trackers.github;
	}
	if (name === "linear") {
		return trackers.linear;
	}
	return null;
}

function trackerError(error: unknown): Response {
	const message = error instanceof Error ? error.message : "reply failed";
	const status =
		error instanceof Error &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: 502;
	return Response.json({ error: message }, { status });
}

async function threadResponse(
	trackers: Trackers,
	trackerName: string,
	key: string,
	request: Request,
): Promise<Response> {
	const tracker = trackerFor(trackers, trackerName);
	const project = new URL(request.url).searchParams.get("project") ?? "";
	if (tracker?.fetchThread === undefined || project.trim() === "") {
		return Response.json({ error: "thread not found" }, { status: 404 });
	}
	try {
		const thread: Thread | null = await tracker.fetchThread(
			project,
			decodeURIComponent(key),
		);
		if (thread === null) {
			return Response.json({ error: "thread not found" }, { status: 404 });
		}
		return Response.json({
			...thread,
			comments: commentTree(thread.comments),
		});
	} catch (error) {
		return trackerError(error);
	}
}

async function replyResponse(
	trackers: Trackers,
	request: Request,
	store: Store,
	notifier: Notifier,
	configuration: Configuration,
	viewers: Viewer[],
): Promise<Response> {
	const parsed = replyBody.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: "invalid reply" }, { status: 400 });
	}
	const tracker = trackerFor(trackers, parsed.data.tracker);
	if (tracker?.postReply === undefined) {
		return Response.json({ error: "tracker unavailable" }, { status: 404 });
	}
	if (parsed.data.body.trim() === "") {
		return Response.json({ error: "reply is empty" }, { status: 400 });
	}
	const row = rowForReply(store, parsed.data);
	const reply: ReplyRequest = {
		tracker: parsed.data.tracker,
		project: parsed.data.project,
		key: parsed.data.key,
		body: panelReplyBody(
			row?.tickets.find((ticket) => ticket.key === parsed.data.key),
			parsed.data.body,
			projectHasNoSenior(
				configuration.noSenior,
				row?.key ?? parsed.data.project,
				parsed.data.tracker,
			),
			parsed.data.parentId,
		),
		...(parsed.data.parentId === undefined
			? {}
			: { parentId: parsed.data.parentId }),
		...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
	};
	try {
		const created: PostedReply = await tracker.postReply(reply);
		recordPostedReply(store, reply, created);
		notifier.publish({
			overview: overview(store, configuration, viewers),
			notifications: [],
		});
		return Response.json(created, { status: 201 });
	} catch (error) {
		return trackerError(error);
	}
}

function rowForReply(
	store: Store,
	reply: { tracker: string; project: string; key: string },
): Snapshot | undefined {
	const repo = githubTicketKey(reply.key)?.repo;
	return store.readTickets().find((item) => {
		if (item.tracker !== reply.tracker) {
			return false;
		}
		if (item.key === reply.project || item.name === reply.project) {
			return true;
		}
		return repo !== undefined && item.key === repo;
	});
}

function recordPostedReply(
	store: Store,
	reply: ReplyRequest,
	created: PostedReply,
): void {
	const row = rowForReply(store, reply);
	if (row === undefined) {
		return;
	}
	const comment: Comment = {
		body: created.body,
		createdAt: created.createdAt,
		reactions: 0,
	};
	store.mergeTickets([
		{
			...row,
			tickets: row.tickets.map((ticket) =>
				ticket.key === reply.key
					? { ...ticket, comments: [...(ticket.comments ?? []), comment] }
					: ticket,
			),
		},
	]);
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
				for (const notification of change.notifications) {
					controller.enqueue(
						encoder.encode(
							`event: notification\ndata: ${JSON.stringify(notification)}\n\n`,
						),
					);
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
	fallback: Configuration;
	fullPoll: Set<string>;
	lastFullPollAt: Map<string, number>;
	holdLists: Promise<void>;
	viewers: Viewer[];
	attention: Attention;
	attentionFor: (active: Configuration) => Attention;
	seenNotifications: Set<string>;
	primed: boolean;
};

async function poll(options: PollOptions): Promise<Configuration> {
	const polledAt = options.clock.now();
	const before = options.attention;
	let configuration: Configuration;
	try {
		configuration = await options.configuration.read();
	} catch (error) {
		const message = error instanceof Error ? error.message : "poll failed";
		options.store.recordFetchError(message);
		if (options.store.readTickets().length > 0) {
			options.notifier.publish({
				overview: overview(options.store, options.fallback, options.viewers),
				notifications: [],
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
	const github = options.github;
	let githubPage: { projects: FoundProject[]; viewer: Viewer | null } = {
		projects: [],
		viewer: null,
	};
	let linearViewer: Viewer | null = null;
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
		try {
			const linearPage = await linear.findProjects();
			linearViewer = linearPage.viewer;
			mergeFound(discovered, linearPage.projects);
		} catch (error) {
			failed = error instanceof Error ? error.message : "poll failed";
		}
	}
	options.viewers = [githubPage.viewer, linearViewer].flatMap((viewer) =>
		viewer === null ? [] : [viewer],
	);
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
				found.push({
					key: refKey(pin),
					tracker: pin.tracker,
					updatedAt: null,
				});
				continue;
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
			const hidden = hiddenKeys.has(project.key);
			outcomes.set(project.key, {
				key: project.key,
				ok: false,
				error: project.tracker === "github" ? missingToken : missingLinearKey,
				full: false,
				// A project with a missing credential shows its error as a pin does.
				pinned: true,
				hidden,
				row: {
					key: project.key,
					name: project.name ?? project.key,
					tracker: project.tracker,
					tickets: [],
					pulls: [],
					branches: [],
					startedKeys,
				},
			});
			continue;
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
	const nextOverview = overview(options.store, configuration, options.viewers);
	const after = options.attentionFor(configuration);
	const notifications = options.primed
		? notificationsFor(
				before,
				after,
				configuration.notificationTriggers,
				polledAt.toISOString(),
				options.seenNotifications,
			)
		: [];

	if (!options.primed) {
		for (const id of primeAttention(after)) {
			options.seenNotifications.add(id);
		}
		options.primed = true;
	}
	for (const entry of notifications) {
		options.seenNotifications.add(entry.id);
	}
	options.attention = after;
	options.store.appendNotifications(notifications);
	options.notifier.publish({
		overview: nextOverview,
		notifications,
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
	let pollOptions: PollOptions;
	const attentionFor = (active: Configuration): Attention =>
		attentionOf(
			projectViews(opened.store, active, pollOptions.viewers),
			active.noSenior,
		);
	pollOptions = {
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
		viewers: [],
		attentionFor,
		attention: {
			needsYou: [],
			comments: new Map(),
			blockers: new Map(),
			closed: new Set(),
		},
		seenNotifications: new Set(
			opened.store.readNotifications().map((entry) => entry.id),
		),
		primed: opened.store.readTickets().length > 0,
	};
	if (pollOptions.primed) {
		pollOptions.attention = attentionFor(configuration);
	}
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
		setTimeout(releaseLists, 1_000).unref?.();
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
				configuration = await poll(pollOptions);
				pollOptions.fallback = configuration;
			} catch (error) {
				if (stopped) {
					return;
				}
				const message = error instanceof Error ? error.message : "poll failed";
				opened.store.recordFetchError(message);
				if (opened.store.readTickets().length === 0) {
					throw error;
				}
				notifier.publish({
					overview: overview(opened.store, configuration, pollOptions.viewers),
					notifications: [],
				});
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
		const projectErrors = rows.map((row) => opened.store.projectError(row.key));
		const everyFailureIsMissingCredential =
			projectErrors.length > 0 &&
			projectErrors.every(
				(error) => error === missingToken || error === missingLinearKey,
			);
		const otherFailure = projectErrors.find(
			(error) =>
				error !== null && error !== missingToken && error !== missingLinearKey,
		);
		const coldError = everyFailureIsMissingCredential
			? null
			: (firstStatus.error ?? otherFailure ?? null);
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
			"/needs-you": page,
			"/inbox": page,
			"/projects/*": page,
			"/api/overview": {
				GET: () => {
					const body = Response.json(
						overview(opened.store, configuration, pollOptions.viewers),
					);
					releaseLists();
					return body;
				},
			},
			"/api/needs-you": {
				GET: () =>
					Response.json(
						projectViews(
							opened.store,
							configuration,
							pollOptions.viewers,
						).flatMap((item) => item.items),
					),
			},
			"/api/inbox": {
				GET: () => Response.json(opened.store.readNotifications()),
			},
			"/api/projects/:name": {
				GET: (request) => {
					const name = request.params.name;
					const report = reportFor(
						opened.store,
						configuration,
						pollOptions.viewers,
						name,
					);
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
			"/api/threads/:tracker/:key": {
				GET: (request) =>
					threadResponse(
						trackers,
						request.params.tracker,
						request.params.key,
						request,
					),
			},
			"/api/replies": {
				POST: (request) =>
					replyResponse(
						trackers,
						request,
						opened.store,
						notifier,
						configuration,
						pollOptions.viewers,
					),
			},
		},
	});
	if (hadRows) {
		setTimeout(() => void pollAgain(), 0);
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
