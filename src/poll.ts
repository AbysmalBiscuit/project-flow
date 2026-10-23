import type { AutoMerge, Configuration } from "./configuration.ts";
import type {
	Overview,
	PollProgress,
	ProjectPoll,
	Snapshot,
	WorkcellRun,
} from "./domain.ts";
import {
	type Attention,
	attentionIds,
	attentionOf,
	checkoutBasenames,
	checkoutNamesProject,
	departedNeedsYouIds,
	githubRepoForTodo,
	linearKeysForNames,
	linearNamesFromCheckouts,
	needsYouSeenId,
	notificationsFor,
	projectSnapshots,
	reconcilePoll,
	startedTodoKeys,
	todoRows,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import {
	githubProjectByNumber,
	missingToken,
	type RestCache,
	retainListWindows,
} from "./github.ts";
import { missingLinearKey } from "./linear.ts";
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
import {
	overview,
	projectViews,
	seededForProjects,
	viewerLogins,
} from "./project-views.ts";
import { matchesRef, refKey } from "./settings-catalogue.ts";

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

const fullPollPeriodMs = 10 * 60 * 1000;
export type PollOptions = {
	configuration: ConfigurationPort;
	github: Tracker | null;
	linear: Tracker | null;
	store: Store;
	clock: Clock;
	notifier: Notifier;
	token: string | null;
	fetch: Fetch;
	fetchGithub: Fetch;
	restCache: RestCache;
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
	const discoveredKeys = new Set(
		discovered.map((project) => `${project.tracker}:${project.key}`),
	);
	const found = [...discovered];
	const trackedProjects = new Set<FoundProject>();
	for (const pin of configuration.tracked) {
		const known = found.find((project) => matchesRef(project, pin));
		if (known !== undefined) {
			trackedProjects.add(known);
			continue;
		}
		const located =
			pin.tracker === "github" && "project" in pin && options.token !== null
				? await githubProjectByNumber(
						options.token,
						options.fetchGithub,
						pin.owner,
						pin.project,
					)
				: { key: refKey(pin), tracker: pin.tracker, updatedAt: null };
		if (located !== null) {
			found.push(located);
			trackedProjects.add(located);
		}
	}
	options.catalogue = found.map((project) => ({
		...project,
		...(discoveredKeys.has(`${project.tracker}:${project.key}`)
			? {}
			: { configuredOnly: true }),
	}));
	options.releaseDiscovery();
	const tracked = found.filter((project) => trackedProjects.has(project));
	const trackedKeys = new Set(tracked.map((project) => project.key));
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
			options.store.lastGoodPollAt(project.key) === null ? [project.key] : [],
		),
	);
	const listed = [];
	const storedRows = options.store.readTickets();
	const fillAsPolled = storedRows.length === 0;
	for (const project of tracked) {
		const tracker = project.tracker === "github" ? github : linear;
		if (tracker === null) {
			outcomes.set(project.key, {
				key: project.key,
				ok: false,
				error: project.tracker === "github" ? missingToken : missingLinearKey,
				full: false,
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
			notePollProgress(options, configuration, tracked, outcomes);
			continue;
		}
		const lastGood = options.store.lastGoodPollAt(project.key);
		const lastFull = options.lastFullPollAt.get(project.key) ?? null;
		const stored = storedRows.find((row) => row.key === project.key);
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
			options.fullPoll.add(project.key);
		}
		const since = full ? null : lastGood;
		try {
			const listedTickets = await tracker.listTickets(
				project.key,
				since,
				project.owner,
				since === null ? [] : (stored?.tickets ?? []),
			);
			const pulls = await tracker.listPulls(
				project.key,
				project.tracker === "linear" ? since : null,
				project.owner,
			);
			const branches =
				project.tracker === "github" && github !== null
					? await github.listBranches(project.key)
					: [];
			if (github !== null) {
				const repos = new Set([
					...pulls.map((pull) => pull.repo),
					...(project.tracker === "github" ? [project.key] : []),
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
					: {
							board:
								project.owner === undefined || project.number === undefined
									? listedTickets.board
									: {
											...listedTickets.board,
											laneKey: `${project.owner}/${project.number}`,
										},
						}),
				...(project.closed === undefined ? {} : { closed: project.closed }),
			});
			outcomes.set(project.key, {
				key: project.key,
				ok: true,
				error: null,
				full,
				row: null,
			});
			options.store.clearProjectError(project.key);
			if (project.tracker === "github" && project.key.includes("/")) {
				retainListWindows(
					options.restCache,
					project.key,
					options.store.forgetValidator,
				);
			}
			const shown = projectSnapshots(listed);
			const visible = new Set(shown.map((item) => item.key));
			const sourceEmpty = new Map(
				listed.map((item) => [item.key, item.tickets.length === 0]),
			);
			for (const item of listed) {
				const outcome = outcomes.get(item.key);
				if (outcome?.ok !== true) {
					continue;
				}
				const row = shown.find((candidate) => candidate.key === item.key);
				outcome.row =
					row === undefined
						? null
						: { ...row, listedEmpty: sourceEmpty.get(item.key) === true };
			}
			if (fillAsPolled && visible.has(project.key)) {
				publishPoll(options, configuration, trackedKeys, outcomes, [], null);
			}
			notePollProgress(options, configuration, tracked, outcomes);
		} catch (error) {
			if (options.stopped) {
				continue;
			}
			const message = error instanceof Error ? error.message : "poll failed";
			const empty: Snapshot = {
				key: project.key,
				name: project.name ?? stored?.name ?? project.key,
				tracker: project.tracker,
				tickets: [],
				pulls: [],
				branches: [],
				startedKeys,
				...(project.owner === undefined ? {} : { owner: project.owner }),
				...(project.number === undefined ? {} : { number: project.number }),
			};
			outcomes.set(project.key, {
				key: project.key,
				ok: false,
				error: message,
				full,
				row: stored ?? empty,
			});
			if (fillAsPolled) {
				publishPoll(options, configuration, trackedKeys, outcomes, [], null);
			}
			notePollProgress(options, configuration, tracked, outcomes);
		}
	}
	const fullKeys = [...options.fullPoll];
	for (const key of fullKeys) {
		if (outcomes.get(key)?.ok === true) {
			options.fullPoll.delete(key);
			options.lastFullPollAt.set(key, polledAt.getTime());
		}
	}
	for (const outcome of outcomes.values()) {
		if (outcome.ok) {
			options.store.recordGoodPoll(outcome.key, polledAt);
		}
	}
	options.polling = false;
	const finished: PollProgress = {
		done: tracked.length,
		total: tracked.length,
		project: null,
		ended: true,
	};
	options.progress = finished;
	if (options.stopped) {
		return configuration;
	}
	publishPoll(
		options,
		configuration,
		trackedKeys,
		outcomes,
		fullKeys,
		failed,
		false,
	);
	const views = projectViews(options, configuration);
	const after = attentionOf(views, configuration.pmBot);
	const firstGood = new Set(
		listed.flatMap((project) =>
			awaitingFirstPoll.has(project.key) ? [project.name] : [],
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
	tracked: FoundProject[],
	outcomes: Map<string, ProjectPoll>,
): void {
	if (!options.polling || options.stopped || !options.mayPublish()) {
		return;
	}
	const next = tracked.find((project) => !outcomes.has(project.key));
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
	trackedKeys: ReadonlySet<string>,
	outcomes: Map<string, ProjectPoll>,
	fullKeys: string[],
	failed: string | null,
	publish = true,
): void {
	const stored = options.store.readTickets();
	for (const row of stored) {
		if (!trackedKeys.has(row.key)) {
			options.store.forgetGoodPoll(row.key);
		}
	}
	const reconciled = reconcilePoll(
		stored.filter((row) => trackedKeys.has(row.key)),
		[...outcomes.values()],
		fullKeys,
	);
	options.store.replaceTickets(reconciled.rows);
	for (const projectError of reconciled.projectErrors) {
		options.store.recordProjectError(projectError.key, projectError.error);
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
