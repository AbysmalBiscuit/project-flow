import {
	attentionIds,
	attentionOf,
	departedNeedsYouIds,
	notificationsFor,
} from "./attention.ts";
import type { AutoMerge, Configuration } from "./configuration.ts";
import {
	checkoutBasenames,
	checkoutNamesProject,
	githubRepoForTodo,
	linearKeysForNames,
	linearNamesFromCheckouts,
	projectSnapshots,
	startedTodoKeys,
	todoRows,
} from "./discovery.ts";
import type {
	Attention,
	ListedProject,
	Overview,
	PollProgress,
	ProjectPoll,
	Snapshot,
	WorkcellRun,
} from "./domain.ts";
import { missingToken } from "./github.ts";
import { missingLinearKey } from "./linear.ts";
import { reconcilePoll } from "./poll-merge.ts";
import type {
	CheckoutSource,
	Clock,
	ConfigurationPort,
	FoundProject,
	GithubTracker,
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
	refListed,
	refRepo,
	sameProject,
} from "./project-ref.ts";
import {
	overview,
	projectViews,
	seededForProjects,
	viewerLogins,
} from "./project-views.ts";
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
		...(project.owner === undefined ? {} : { owner: project.owner }),
		...(project.number === undefined ? {} : { number: project.number }),
	};
}

const fullPollPeriodMs = 10 * 60 * 1000;
const concurrentReads = 4;
export type PollOptions = {
	configuration: ConfigurationPort;
	github: GithubTracker | null;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
	notifier: Notifier;
	listTodos?: TodoSource | undefined;
	listCheckouts?: CheckoutSource | undefined;
	releaseDiscovery: () => void;
	fallback: Configuration;
	fullPoll: Set<string>;
	lastFullPollAt: Map<string, number>;
	holdLists: Promise<void>;
	viewers: Viewer[];
	runs: WorkcellRun[];
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
};

export async function poll(options: PollOptions): Promise<Configuration> {
	options.github?.beginPoll?.();
	options.linear?.beginPoll?.();
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
	const linear = options.linear;
	const github = options.github;
	let githubPage: {
		projects: FoundProject[];
		viewer: Viewer | null;
		error?: string;
	} = {
		projects: [],
		viewer: null,
	};
	let linearViewer: Viewer | null = null;
	let failed: string | null = null;
	if (github !== null) {
		try {
			githubPage = await github.findProjects();
			if (githubPage.error !== undefined) {
				failed = githubPage.error;
			}
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
		mergeFound(discovered, [
			{ key: checkout.repo.trim(), tracker: "github", updatedAt: null },
		]);
	}
	const rows = todoRows(todoListing);
	for (const row of rows) {
		const repo = githubRepoForTodo(row.project, checkoutBasenames(checkouts));
		if (repo === null) {
			continue;
		}
		mergeFound(discovered, [{ key: repo, tracker: "github", updatedAt: null }]);
	}
	if (linear !== null) {
		const keys = linearKeysForNames(linearNamesFromCheckouts(checkouts, rows));
		mergeFound(discovered, (await linear.projectsForKeys?.(keys)) ?? []);
	}
	const found = [...discovered];
	const trackedProjects = new Map<FoundProject, TrackedProject>();
	for (const pin of configuration.tracked) {
		const ref = pinRef(pin);
		const known = found.find((project) => sameProject(listedRef(project), ref));
		const located =
			known ??
			(ref.kind === "github-project" && github !== null
				? await github.findPinnedProject(ref.owner, ref.number)
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
	const listed: (ListedProject &
		Pick<TrackedProject, "ref"> & { name: string })[] = [];
	const storedRows = options.store.readTickets();
	const trackedOrder = new Map(
		tracked.map((project, index) => [projectId(project.ref), index]),
	);
	const orderOf = (ref: TrackedProject["ref"]) =>
		trackedOrder.get(projectId(ref)) ?? tracked.length;
	const readProject = async (project: TrackedProject): Promise<void> => {
		const id = projectId(project.ref);
		const tracker = project.tracker === "github" ? github : linear;
		if (tracker === null) {
			outcomes.set(id, {
				ref: project.ref,
				ok: false,
				error: project.tracker === "github" ? missingToken : missingLinearKey,
				full: false,
				row: emptySnapshot(project, project.name ?? project.key, startedKeys),
			});
			notePollProgress(options, configuration, tracked, outcomes);
			return;
		}
		const lastGood = options.store.lastGoodPollAt(project.ref);
		const lastFull = options.lastFullPollAt.get(id) ?? null;
		const stored = storedRows.find((row) =>
			sameProject(listedRef(row), project.ref),
		);
		const emptyStored =
			stored !== undefined &&
			stored.tickets.length === 0 &&
			stored.listedEmpty !== false;
		const missingRow = stored === undefined && lastFull === null;
		const full =
			lastGood === null ||
			emptyStored ||
			missingRow ||
			(project.tracker === "linear" &&
				(lastFull === null ||
					polledAt.getTime() - lastFull >= fullPollPeriodMs));
		if (full) {
			options.fullPoll.add(id);
		}
		const since = full ? null : lastGood;
		try {
			const listedTickets = await tracker.listTickets(
				project,
				since,
				since === null ? [] : (stored?.tickets ?? []),
			);
			const pulls = await tracker.listPulls(
				project,
				project.tracker === "linear" ? since : null,
			);
			const repo = refRepo(project.ref);
			const branches =
				repo !== null && github !== null ? await github.listBranches(repo) : [];
			if (github !== null) {
				const repos = new Set([
					...pulls.map((pull) => pull.repo),
					...(repo === null ? [] : [repo]),
				]);
				for (const repo of repos) {
					if (readRepos.has(repo)) {
						continue;
					}
					readRepos.add(repo);
					try {
						options.repoAutoMerge[repo] = await github.repoAutoMerge(repo);
					} catch {
						options.repoAutoMerge[repo] = false;
					}
				}
			}
			listed.push({
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
			});
			listed.sort((left, right) => orderOf(left.ref) - orderOf(right.ref));
			outcomes.set(id, {
				ref: project.ref,
				ok: true,
				error: null,
				full,
				row: null,
			});
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
			if (shown.has(id)) {
				publishPoll(options, configuration, trackedIds, outcomes, false, null);
			}
			notePollProgress(options, configuration, tracked, outcomes);
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
			outcomes.set(id, {
				ref: project.ref,
				ok: false,
				error: message,
				full,
				row: stored ?? empty,
			});
			publishPoll(options, configuration, trackedIds, outcomes, false, null);
			notePollProgress(options, configuration, tracked, outcomes);
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
	const fullPolled = options.fullPoll.size > 0;
	for (const id of [...options.fullPoll]) {
		if (outcomes.get(id)?.ok === true) {
			options.fullPoll.delete(id);
			options.lastFullPollAt.set(id, polledAt.getTime());
		}
	}
	for (const outcome of outcomes.values()) {
		if (outcome.ok) {
			options.store.recordGoodPoll(outcome.ref, polledAt);
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
		return outcome === undefined ? [] : [outcome];
	});
	const reconciled = reconcilePoll(kept, ordered, fullPolled);
	options.store.replaceTickets(reconciled.rows);
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
