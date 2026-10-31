import {
	attentionIds,
	attentionOf,
	departedNeedsYouIds,
	notificationsFor,
} from "./attention.ts";
import type { Backends } from "./backends.ts";
import type { AutoMerge, Configuration, Factory } from "./configuration.ts";
import {
	checkoutBasenames,
	checkoutProjects,
	namedTicketKeys,
	projectSnapshots,
	startedTodoKeys,
	todoProjects,
	todoRows,
} from "./discovery.ts";
import type {
	Attention,
	FactoryRun,
	LinearSource,
	ListedProject,
	Overview,
	PollProgress,
	ProjectPoll,
	Snapshot,
	TrackerKind,
	WorkcellRun,
} from "./domain.ts";
import { reconcilePoll } from "./poll-merge.ts";
import { listPulls } from "./poll-pulls.ts";
import type {
	CheckoutSource,
	Clock,
	ConfigurationPort,
	FoundProject,
	Notifier,
	Store,
	TodoSource,
	TrackedProject,
	Tracker,
	Viewer,
} from "./ports.ts";
import {
	listedRef,
	pinRef,
	projectId,
	refBoard,
	refListed,
	refRepo,
	sameProject,
	settingsKey,
} from "./project-ref.ts";
import {
	overview,
	projectViews,
	seededForProjects,
	viewerLogins,
} from "./project-views.ts";
import type { StartRequest } from "./run-start.ts";
import { needsYouSeenId } from "./ticket-key.ts";

function mergeFound(
	found: FoundProject[],
	next: FoundProject[],
): FoundProject[] {
	for (const project of next) {
		const ref = listedRef(project);
		if (!found.some((item) => sameProject(listedRef(item), ref))) {
			found.push(project);
		}
	}
	return found;
}

function emptySnapshot(
	project: TrackedProject,
	name: string,
	startedKeys: string[],
): Snapshot {
	return {
		key: project.key,
		name,
		tracker: project.tracker,
		tickets: [],
		pulls: [],
		branches: [],
		startedKeys,
		...(project.host === undefined ? {} : { host: project.host }),
		...(project.owner === undefined ? {} : { owner: project.owner }),
		...(project.number === undefined ? {} : { number: project.number }),
	};
}

function unreadProject(
	project: TrackedProject,
	error: string,
	startedKeys: string[],
): ProjectPoll {
	return {
		ref: project.ref,
		ok: false,
		error,
		full: false,
		row: emptySnapshot(project, project.name ?? project.key, startedKeys),
	};
}

const fullPollPeriodMs = 10 * 60 * 1000;
const concurrentReads = 4;

type PolledProject = ListedProject &
	Pick<TrackedProject, "ref"> & { name: string };

/** The newest project read of each project: an older read that ends later never writes over it. */
export type ProjectReads = {
	count: number;
	newest: Map<string, { read: number; outcome: ProjectPoll }>;
};

function noteRead(
	options: PollOptions,
	id: string,
	read: number,
	outcome: ProjectPoll,
): boolean {
	const newest = options.projectReads.newest.get(id);
	if (newest !== undefined && newest.read > read) {
		return false;
	}
	options.projectReads.newest.set(id, { read, outcome });
	return true;
}

/** Runs `run` once for all the calls queued in one turn of the event loop. */
function oncePerTurn(run: (publish: boolean) => void) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let publish = false;
	return {
		queue(wanted: boolean) {
			publish ||= wanted;
			timer ??= setTimeout(() => {
				const due = publish;
				timer = undefined;
				publish = false;
				run(due);
			}, 0);
		},
		cancel() {
			clearTimeout(timer);
			timer = undefined;
			publish = false;
		},
	};
}

/** The time of the last good read to read changes since, or null for a full read. */
function readSince(
	options: PollOptions,
	project: TrackedProject,
	tracker: Tracker,
	stored: Snapshot | undefined,
	polledAt: Date,
): Date | null {
	const id = projectId(project.ref);
	const lastGood = options.store.lastGoodPollAt(project.ref);
	const intervalStart =
		stored === undefined
			? undefined
			: tracker.fullReadIntervalStart?.(polledAt);
	if (intervalStart !== undefined) {
		options.lastFullPollAt.set(
			id,
			options.lastFullPollAt.get(id) ?? intervalStart.getTime(),
		);
	}
	const lastFull = options.lastFullPollAt.get(id) ?? null;
	const emptyStored =
		stored !== undefined &&
		stored.tickets.length === 0 &&
		stored.listedEmpty !== false;
	const full =
		lastGood === null ||
		emptyStored ||
		lastFull === null ||
		polledAt.getTime() - lastFull >= fullPollPeriodMs;
	return full ? null : lastGood;
}

/**
 * Records the outcome of a read that got its tickets. A read that left out the
 * PRs of a forge with no token counts as no good read, so that the next read is
 * full and finds those links again. An incremental read would clear the error.
 */
function noteGoodRead(
	options: PollOptions,
	outcome: ProjectPoll,
	polledAt: Date,
): void {
	if (outcome.error === null) {
		options.store.recordGoodPoll(outcome.ref, polledAt);
	} else {
		options.store.forgetGoodPoll(outcome.ref);
	}
}

async function readListed(
	options: PollOptions,
	project: TrackedProject,
	tracker: Tracker,
	since: Date | null,
	stored: Snapshot | undefined,
	startedKeys: string[],
	readRepos: Set<string>,
): Promise<{ listing: PolledProject; missingToken: string | null }> {
	const forge = options.backends.forgeOf(project.ref);
	const listedTickets = await tracker.listTickets(
		project,
		since,
		since === null ? [] : (stored?.tickets ?? []),
	);
	const { lists, missingToken } = await listPulls(
		options.backends,
		project,
		tracker,
		since,
	);
	const repo = refRepo(project.ref);
	const branches =
		repo !== null && forge !== null ? await forge.listBranches(repo) : [];
	const { keyHostOf } = options.backends;
	const pulls = lists.flatMap((list) => {
		const host = keyHostOf(list.forge);
		return host === undefined
			? list.pulls
			: list.pulls.map((pull) => ({ ...pull, host }));
	});
	const repoReads = new Map(
		lists.flatMap((list) =>
			list.pulls.map(
				(pull) =>
					[
						settingsKey(pull.repo, keyHostOf(list.forge)),
						{ repo: pull.repo, forge: list.forge },
					] as const,
			),
		),
	);
	if (repo !== null && forge !== null) {
		repoReads.set(settingsKey(repo, keyHostOf(forge)), { repo, forge });
	}
	for (const [id, read] of repoReads) {
		if (readRepos.has(id)) {
			continue;
		}
		readRepos.add(id);
		try {
			options.repoAutoMerge[id] = await read.forge.repoAutoMerge(read.repo);
		} catch {
			options.repoAutoMerge[id] = false;
		}
	}
	return {
		listing: {
			...project,
			name: project.name ?? listedTickets.name,
			tickets: listedTickets.tickets,
			pulls,
			branches,
			startedKeys,
			...(listedTickets.board === undefined
				? {}
				: { board: listedTickets.board }),
			...(project.closed === undefined ? {} : { closed: project.closed }),
		},
		missingToken,
	};
}

export type PollOptions = {
	configuration: ConfigurationPort;
	backends: Backends;
	store: Store;
	clock: Clock;
	notifier: Notifier;
	listTodos?: TodoSource | undefined;
	listCheckouts?: CheckoutSource | undefined;
	releaseDiscovery: () => void;
	fallback: Configuration;
	fullPoll: Set<string>;
	lastFullPollAt: Map<string, number>;
	projectReads: ProjectReads;
	holdLists: Promise<void>;
	viewers: Viewer[];
	runs: WorkcellRun[];
	factoryRuns: () => FactoryRun[];
	/** The factories that this launch reads: the `--factory` list, or else the configured factories. */
	listedFactories: () => readonly Factory[];
	/** The Linear sources of the listed hubs, which map the start of a Linear ticket. */
	linearSources: () => readonly LinearSource[];
	/** Each start request that the app sent, by folded ticket key. The route replaces the map on each request. */
	runStartRequests: ReadonlyMap<string, StartRequest>;
	workcellAuto: Record<string, AutoMerge>;
	repoAutoMerge: Record<string, boolean>;
	attention: Attention;
	seenNotifications: Set<string>;
	primed: boolean;
	polling: boolean;
	progress: PollProgress | null;
	stopped: boolean;
	catalogue: FoundProject[];
	/** False when a tracked-list write landed after this poll started. */
	mayPublish: () => boolean;
	factoryUnreachable: () => boolean;
};

export async function poll(options: PollOptions): Promise<Configuration> {
	for (const tracker of options.backends.trackers.values()) {
		tracker.beginPoll?.();
	}
	for (const forge of options.backends.forges.values()) {
		forge.beginPoll?.();
	}
	await options.holdLists;
	if (options.stopped) {
		options.polling = false;
		options.notifier.publish({
			overview: overview(options, options.fallback),
			notifications: [],
		});
		return options.fallback;
	}
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
				overview: overview(options, options.fallback),
				notifications: [],
			});
		}
		return options.fallback;
	}
	const todoListing = (await options.listTodos?.()) ?? "";
	const checkouts =
		(await options
			.listCheckouts?.(configuration.checkoutRoots)
			.catch(() => [])) ?? [];
	const startedKeys = startedTodoKeys(
		todoListing,
		checkoutBasenames(checkouts),
	);
	options.runs = checkouts.flatMap((checkout) => checkout.runs ?? []);
	options.workcellAuto = {};
	const readRepos = new Set<string>();
	for (const checkout of checkouts) {
		const repo = checkout.repo;
		if (repo !== undefined && checkout.mergeAuto !== undefined) {
			options.workcellAuto[repo] = checkout.mergeAuto;
		}
	}
	const trackers = options.backends.trackers;
	const viewers = new Map<TrackerKind, Viewer>();
	const discovered: FoundProject[] = [];
	let failed: string | null = null;
	for (const [kind, tracker] of trackers) {
		try {
			const page = await tracker.findProjects();
			if (page.error !== undefined) {
				failed = page.error;
			}
			if (page.viewer !== null) {
				viewers.set(kind, page.viewer);
			}
			mergeFound(discovered, page.projects);
		} catch (error) {
			failed = error instanceof Error ? error.message : "poll failed";
		}
	}
	options.viewers = [...viewers.values()];
	mergeFound(
		discovered,
		checkoutProjects(checkouts, (kind) => viewers.get(kind) ?? null),
	);
	const rows = todoRows(todoListing);
	mergeFound(discovered, todoProjects(rows, checkouts));
	const keys = namedTicketKeys(checkouts, rows);
	for (const tracker of trackers.values()) {
		mergeFound(discovered, (await tracker.projectsForKeys?.(keys)) ?? []);
	}
	const found = [...discovered];
	const trackedProjects = new Map<FoundProject, TrackedProject>();
	for (const pin of configuration.tracked) {
		const ref = pinRef(pin);
		const known = found.find((project) => sameProject(listedRef(project), ref));
		const board = refBoard(ref);
		const findPinned = trackers.get(ref.tracker)?.findPinnedProject;
		const located =
			known ??
			(board !== null && findPinned !== undefined
				? await findPinned(board.owner, board.number)
				: { ...refListed(ref), updatedAt: null });
		if (located === null) {
			continue;
		}
		if (known === undefined) {
			found.push(located);
		}
		trackedProjects.set(located, { ...located, ref: listedRef(located) });
	}
	options.catalogue = found.map((project) =>
		discovered.includes(project)
			? project
			: { ...project, configuredOnly: true },
	);
	options.releaseDiscovery();
	const tracked = found.flatMap((project) => {
		const resolved = trackedProjects.get(project);
		return resolved === undefined ? [] : [resolved];
	});
	const trackedIds = new Set(tracked.map((project) => projectId(project.ref)));
	const started: PollProgress = {
		done: 0,
		total: tracked.length,
		project: tracked[0]?.key ?? null,
		ended: false,
	};
	options.progress = started;
	if (options.polling && !options.stopped && options.mayPublish()) {
		options.notifier.publish({
			overview: runningOverview(options, configuration),
			notifications: [],
			progress: started,
		});
	}
	const outcomes = new Map<string, ProjectPoll>();
	const awaitingFirstPoll = new Set(
		tracked.flatMap((project) =>
			options.store.lastGoodPollAt(project.ref) === null
				? [projectId(project.ref)]
				: [],
		),
	);
	const listed: PolledProject[] = [];
	// Reads that end in one turn of the event loop publish once, so that a
	// burst of reads does not hold the API reads behind one overview each.
	const step = oncePerTurn((publish) => {
		if (options.stopped) {
			return;
		}
		if (publish) {
			publishPoll(options, configuration, trackedIds, outcomes, false, null);
		}
		notePollProgress(options, configuration, tracked, outcomes);
	});
	const storedRows = options.store.readTickets();
	const trackedOrder = new Map(
		tracked.map((project, index) => [projectId(project.ref), index]),
	);
	const orderOf = (ref: TrackedProject["ref"]) =>
		trackedOrder.get(projectId(ref)) ?? tracked.length;
	const readProject = async (project: TrackedProject): Promise<void> => {
		const id = projectId(project.ref);
		const read = ++options.projectReads.count;
		const reader = options.backends.readerOf(project.ref, configuration.hosts);
		if ("error" in reader) {
			const outcome = unreadProject(project, reader.error, startedKeys);
			outcomes.set(id, outcome);
			noteRead(options, id, read, outcome);
			notePollProgress(options, configuration, tracked, outcomes);
			return;
		}
		const stored = storedRows.find((row) =>
			sameProject(listedRef(row), project.ref),
		);
		const { tracker } = reader;
		const since = readSince(options, project, tracker, stored, polledAt);
		const full = since === null;
		if (full) {
			options.fullPoll.add(id);
		}
		try {
			const { listing, missingToken } = await readListed(
				options,
				project,
				tracker,
				since,
				stored,
				startedKeys,
				readRepos,
			);
			listed.push(listing);
			listed.sort((left, right) => orderOf(left.ref) - orderOf(right.ref));
			const outcome: ProjectPoll = {
				ref: project.ref,
				ok: true,
				error: missingToken,
				full,
				row: null,
			};
			outcomes.set(id, outcome);
			noteRead(options, id, read, outcome);
			options.store.clearProjectError(project.ref);
			const shown = new Map(
				projectSnapshots(listed).map((row) => [projectId(listedRef(row)), row]),
			);
			for (const item of listed) {
				const itemId = projectId(item.ref);
				const outcome = outcomes.get(itemId);
				if (outcome?.ok !== true) {
					continue;
				}
				const row = shown.get(itemId);
				outcome.row =
					row === undefined
						? null
						: { ...row, listedEmpty: item.tickets.length === 0 };
			}
			step.queue(shown.has(id));
		} catch (error) {
			if (options.stopped) {
				return;
			}
			const message = error instanceof Error ? error.message : "poll failed";
			const empty = emptySnapshot(
				project,
				project.name ?? stored?.name ?? project.key,
				startedKeys,
			);
			const outcome: ProjectPoll = {
				ref: project.ref,
				ok: false,
				error: message,
				full,
				row: stored ?? empty,
			};
			outcomes.set(id, outcome);
			noteRead(options, id, read, outcome);
			step.queue(true);
		}
	};
	const queue = [...tracked];
	const reader = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			await readProject(next);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrentReads, queue.length) }, reader),
	);
	step.cancel();
	const fullPolled = options.fullPoll.size > 0;
	for (const id of [...options.fullPoll]) {
		if (outcomes.get(id)?.ok === true) {
			options.fullPoll.delete(id);
			options.lastFullPollAt.set(id, polledAt.getTime());
		}
	}
	for (const outcome of outcomes.values()) {
		if (outcome.ok) {
			noteGoodRead(options, outcome, polledAt);
		}
	}
	const finished: PollProgress = {
		done: tracked.length,
		total: tracked.length,
		project: null,
		ended: true,
	};
	options.progress = finished;
	if (options.stopped) {
		options.polling = false;
		return configuration;
	}
	publishPoll(
		options,
		configuration,
		trackedIds,
		outcomes,
		fullPolled,
		failed,
		false,
	);
	const views = projectViews(options, configuration);
	const after = attentionOf(views, configuration.pmBot);
	const firstGood = new Set(
		listed.flatMap((project) =>
			awaitingFirstPoll.has(projectId(project.ref)) ? [project.name] : [],
		),
	);
	const seeded = seededForProjects(after, firstGood);
	for (const id of seeded) {
		options.seenNotifications.add(id);
	}
	const notifications = options.primed
		? notificationsFor(
				before,
				after,
				configuration.notificationTriggers,
				polledAt.toISOString(),
				options.seenNotifications,
				viewerLogins(configuration, options.viewers),
			)
		: [];
	if (!options.primed) {
		const opened = attentionIds(after);
		for (const id of opened) {
			options.seenNotifications.add(id);
		}
		options.store.recordSeededIds(opened);
		options.primed = true;
	}
	options.store.recordSeededIds(seeded);
	const departed = departedNeedsYouIds(
		before,
		after,
		new Set(views.map((view) => view.row.name)),
	);
	for (const id of departed) {
		options.seenNotifications.delete(id);
	}
	options.store.forgetSeededIds(departed);
	for (const entry of notifications) {
		options.seenNotifications.add(entry.id);
		if (entry.trigger === "needsYou") {
			const seenId = needsYouSeenId(entry);
			options.seenNotifications.add(seenId);
			options.store.recordSeededIds([seenId]);
		}
	}
	options.attention = after;
	options.store.appendNotifications(notifications);
	let current: Configuration;
	try {
		current = await options.configuration.read();
	} catch (error) {
		const message = error instanceof Error ? error.message : "poll failed";
		options.store.recordFetchError(message);
		throw error;
	}
	options.fallback = current;
	options.polling = false;
	if (!options.mayPublish()) {
		return current;
	}
	options.notifier.publish({
		overview: runningOverview(options, current),
		notifications,
		progress: finished,
	});
	options.progress = null;
	return current;
}

/** Read all the tickets of one tracked project and write its row, without a poll of every project. */
export async function pollProject(
	options: PollOptions,
	configuration: Configuration,
	project: TrackedProject,
): Promise<void> {
	const id = projectId(project.ref);
	const read = ++options.projectReads.count;
	const polledAt = options.clock.now();
	const storedRows = options.store.readTickets();
	const stored = storedRows.find((row) =>
		sameProject(listedRef(row), project.ref),
	);
	const startedKeys = stored?.startedKeys ?? [];
	const reader = options.backends.readerOf(project.ref, configuration.hosts);
	let outcome: ProjectPoll;
	if ("error" in reader) {
		outcome = unreadProject(project, reader.error, startedKeys);
	} else {
		const { tracker } = reader;
		tracker.forgetProject?.(project);
		const repo = refRepo(project.ref);
		if (repo !== null) {
			options.backends.forgeOf(project.ref)?.forgetRepo?.(repo);
		}
		try {
			const { listing, missingToken } = await readListed(
				options,
				project,
				tracker,
				null,
				stored,
				startedKeys,
				new Set(),
			);
			const donors = storedRows.flatMap((row) =>
				sameProject(listedRef(row), project.ref)
					? []
					: [{ ...row, updatedAt: null }],
			);
			const shown = projectSnapshots([listing, ...donors]).find((row) =>
				sameProject(listedRef(row), project.ref),
			);
			outcome = {
				ref: project.ref,
				ok: true,
				error: missingToken,
				full: true,
				row:
					shown === undefined
						? null
						: { ...shown, listedEmpty: listing.tickets.length === 0 },
			};
		} catch (error) {
			outcome = {
				ref: project.ref,
				ok: false,
				error: error instanceof Error ? error.message : "poll failed",
				full: true,
				row:
					stored ??
					emptySnapshot(project, project.name ?? project.key, startedKeys),
			};
		}
	}
	if (options.stopped || !noteRead(options, id, read, outcome)) {
		return;
	}
	if (outcome.ok) {
		options.store.clearProjectError(project.ref);
		noteGoodRead(options, outcome, polledAt);
		options.lastFullPollAt.set(id, polledAt.getTime());
	}
	const trackedIds = new Set([
		...options.store.readTickets().map((row) => projectId(listedRef(row))),
		id,
	]);
	publishPoll(
		options,
		configuration,
		trackedIds,
		new Map([[id, outcome]]),
		false,
		null,
	);
}

function notePollProgress(
	options: PollOptions,
	configuration: Configuration,
	tracked: TrackedProject[],
	outcomes: Map<string, ProjectPoll>,
): void {
	if (!options.polling || options.stopped || !options.mayPublish()) {
		return;
	}
	const next = tracked.find((project) => !outcomes.has(projectId(project.ref)));
	if (next === undefined) {
		return;
	}
	const progress: PollProgress = {
		done: outcomes.size,
		total: tracked.length,
		project: next.key,
		ended: false,
	};
	options.progress = progress;
	options.notifier.publish({
		overview: runningOverview(options, configuration),
		notifications: [],
		progress,
	});
}

function publishPoll(
	options: PollOptions,
	configuration: Configuration,
	trackedIds: ReadonlySet<string>,
	outcomes: Map<string, ProjectPoll>,
	fullPolled: boolean,
	failed: string | null,
	publish = true,
): void {
	const stored = options.store.readTickets();
	const kept = stored.filter((row) => {
		const ref = listedRef(row);
		if (trackedIds.has(projectId(ref))) {
			return true;
		}
		options.store.forgetGoodPoll(ref);
		return false;
	});
	const ordered = [...trackedIds].flatMap((id) => {
		const outcome = outcomes.get(id);
		if (outcome === undefined) {
			return [];
		}
		return [options.projectReads.newest.get(id)?.outcome ?? outcome];
	});
	const reconciled = reconcilePoll(kept, ordered, fullPolled);
	// Rows keep the tracked order while a poll runs, so that a project read
	// rewrites only its own row.
	const position = new Map([...trackedIds].map((id, index) => [id, index]));
	const rank = (row: Snapshot) =>
		position.get(projectId(listedRef(row))) ?? position.size;
	options.store.replaceTickets(
		reconciled.rows.toSorted((left, right) => rank(left) - rank(right)),
	);
	for (const projectError of reconciled.projectErrors) {
		options.store.recordProjectError(projectError.ref, projectError.error);
	}
	if (reconciled.globalError !== null) {
		options.store.recordFetchError(reconciled.globalError);
	} else if (failed !== null) {
		options.store.recordFetchError(failed);
	}
	if (!publish || !options.mayPublish()) {
		return;
	}
	options.notifier.publish({
		overview: runningOverview(options, configuration),
		notifications: [],
	});
}

export function runningOverview(
	options: PollOptions,
	configuration: Configuration,
): Overview {
	const body = overview(options, configuration);
	if (!options.polling) {
		return body;
	}
	return { ...body, polling: true };
}
