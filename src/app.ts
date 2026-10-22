import { z } from "zod";
import type { AutoMerge, Configuration } from "./configuration.ts";
import { loadConfiguration, saveConfiguration } from "./configuration.ts";
import type {
	Comment,
	Overview,
	PollProgress,
	PostedReply,
	ProjectCounts,
	ProjectPoll,
	ProjectReport,
	ReplyRequest,
	Snapshot,
} from "./domain.ts";
import {
	type Attention,
	attachGraphStates,
	attentionIds,
	attentionOf,
	checkoutBasenames,
	checkoutNamesProject,
	departedNeedsYouIds,
	expectedBotsByRepo,
	filterProjectReport,
	githubRepoForTodo,
	inboxEntries,
	linearKeysForNames,
	linearNamesFromCheckouts,
	matchesRef,
	needsYouSeenId,
	notificationsFor,
	optionReplyBody,
	panelReplyBody,
	pendingProjects,
	projectCounts,
	projectHasPmBot,
	projectSnapshots,
	projectViewFor,
	reconcilePoll,
	refKey,
	type SettingsProject,
	staleView,
	startedTodoKeys,
	todoRows,
	type WorkcellRun,
} from "./domain.ts";
import { installationTokenFetch } from "./factory-tokens.ts";
import {
	abortableFetch,
	defaultThreadReadLimitMs,
	type Fetch,
} from "./fetch.ts";
import {
	conditionalFetch,
	githubProjectByNumber,
	githubTracker,
	missingToken,
	type RestCache,
	rememberValidator,
	retainListWindows,
} from "./github.ts";
import { githubTicketKey } from "./github-thread.ts";
import page from "./index.html";
import { linearTracker, missingLinearKey } from "./linear.ts";
import { memoryNotifier } from "./notifier.ts";
import { paintPage } from "./page-theme.ts";
import type {
	Change,
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
import type { TicketSearchHit } from "./ticket-key.ts";
import { statusColours } from "./token-palette.ts";

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
	threadReadLimitMs?: number;
};

export type Running = {
	url: URL;
	stop: () => Promise<void>;
	readonly settled: Promise<Error | null>;
};

function seededForProjects(
	attention: Attention,
	projects: ReadonlySet<string>,
): string[] {
	const needsYou = attention.needsYou.flatMap((item) =>
		projects.has(item.project) ? [needsYouSeenId(item)] : [],
	);
	const comments = [...attention.comments].flatMap(([id, comment]) =>
		projects.has(comment.project) ? [`comment\n${id}\n${comment.stamp}`] : [],
	);
	return [...needsYou, ...comments];
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
		pmBot: configuration.pmBot,
		labels: configuration.needsYouLabels,
		viewerLogins: viewerLogins(configuration, viewers),
	};
}

function boardPin(
	row: Snapshot,
): Extract<Configuration["tracked"][number], { owner: string }> | null {
	const [laneOwner, numberText] = row.board?.laneKey?.split("/") ?? [];
	const laneNumber = Number(numberText);
	const owner = row.owner ?? laneOwner;
	const number = row.number ?? laneNumber;
	if (
		row.tracker !== "github" ||
		owner === undefined ||
		owner === "" ||
		!Number.isInteger(number) ||
		number <= 0
	) {
		return null;
	}
	return { tracker: "github", owner, project: number };
}

function sameProjectRef(
	row: Snapshot,
	ref: Configuration["tracked"][number],
): boolean {
	if (refKey(ref) === row.key) {
		return true;
	}
	const board = boardPin(row);
	return (
		board !== null &&
		ref.tracker === "github" &&
		"owner" in ref &&
		ref.owner === board.owner &&
		ref.project === board.project
	);
}

function projectRef(
	row: Snapshot,
	tracked: Configuration["tracked"],
): Configuration["tracked"][number] {
	const pin = tracked.find((ref) => sameProjectRef(row, ref));
	if (pin !== undefined) {
		return pin;
	}
	const board = boardPin(row);
	if (board !== null) {
		return board;
	}
	if (row.tracker === "linear") {
		return { tracker: "linear", project: row.key };
	}
	return { tracker: "github", repo: row.key };
}

function projectViews(options: PollOptions, configuration: Configuration) {
	const rows = options.store
		.readTickets()
		.filter((row) =>
			configuration.tracked.some((ref) => sameProjectRef(row, ref)),
		);
	const all = rows.map((row) => ({
		project: row.key.includes("/") ? row.key : row.name,
		tickets: row.tickets,
	}));
	return rows.map((row) => {
		const goodPoll = options.store.lastGoodPollAt(row.key);
		const viewedAt = goodPoll ?? new Date(0);
		const counted = projectCounts(
			row.name,
			row.key,
			row.tracker,
			row.tickets,
			row.pulls,
			row.branches,
			row.startedKeys,
			options.runs,
			{
				config: configuration.autoMerge,
				workcell: options.workcellAuto,
				repo: options.repoAutoMerge,
			},
			all,
			expectedBotsByRepo(row.pulls, configuration.expectedBots ?? {}),
			{
				fetchedAt: goodPoll?.toISOString() ?? null,
				error: options.store.projectError(row.key),
			},
			needsYouRules(configuration, options.viewers),
			configuration.laneMappings,
			viewedAt,
			statusColours,
			row.board,
		);
		return {
			row,
			items: counted.needsYou,
			counts: {
				...counted.counts,
				ref: projectRef(row, configuration.tracked),
			},
			report: counted.report,
		};
	});
}

function attentionFor(
	options: PollOptions,
	configuration: Configuration,
): Attention {
	return attentionOf(projectViews(options, configuration), configuration.pmBot);
}

function overview(
	options: PollOptions,
	configuration: Configuration,
): Overview {
	const counted = projectViews(options, configuration).map(
		(item) => item.counts,
	);
	const pending = options.polling
		? pendingProjects(
				options.catalogue,
				configuration.tracked,
				counted,
				new Set(
					options.catalogue.flatMap((project) =>
						options.store.lastGoodPollAt(project.key) === null
							? []
							: [project.key],
					),
				),
			)
		: [];
	const projects = [...counted, ...pending];
	const goodPolls = projects.flatMap((project) => {
		const at = options.store.lastGoodPollAt(project.name);
		return at === null ? [] : [at.toISOString()];
	});
	return {
		projects,
		...staleView(
			options.store.fetchStatus(),
			goodPolls.length === 0 ? null : (goodPolls.sort()[0] ?? null),
		),
		...(configuration.tracked.length === 0 ? { tracked: false as const } : {}),
	};
}

export type { TicketSearchHit } from "./ticket-key.ts";
export type { SettingsProject };

function searchTickets(
	views: {
		counts: Pick<ProjectCounts, "name" | "tracker" | "tickets">;
	}[],
	query: string,
): TicketSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return [];
	}
	const hits: TicketSearchHit[] = [];
	for (const view of views) {
		for (const ticket of view.counts.tickets) {
			if (ticket.key === null) {
				continue;
			}
			const key = ticket.key.toLowerCase();
			const title = ticket.title.toLowerCase();
			if (!key.includes(needle) && !title.includes(needle)) {
				continue;
			}
			hits.push({
				project: view.counts.name,
				tracker: view.counts.tracker,
				key: ticket.key,
				title: ticket.title,
				state: ticket.state,
			});
		}
	}
	hits.sort((left, right) => {
		const byProject = left.project.localeCompare(right.project);
		return byProject !== 0 ? byProject : left.key.localeCompare(right.key);
	});
	return hits;
}

function reportFor(
	options: PollOptions,
	configuration: Configuration,
	name: string,
	filtered: boolean,
): ProjectReport | null {
	const views = attachGraphStates(
		projectViews(options, configuration).map((item) => item.report),
	);
	const match = views.find(
		(item) => item.name.toLowerCase() === name.toLowerCase(),
	);
	if (match === undefined) {
		return null;
	}
	const view = projectViewFor(configuration, match.name);
	return filtered
		? filterProjectReport(match, view, options.clock.now())
		: match;
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
	body: z.string().optional(),
	option: z.number().int().positive().optional(),
	parentId: z.string().optional(),
	kind: z.enum(["comment", "review"]).optional(),
});

const readMarkBody = z.object({ read: z.literal(true) });

const readIdsBody = readMarkBody.extend({
	ids: z.array(z.string()),
});

type Trackers = Pick<PollOptions, "github" | "linear">;

async function readMark(request: Request): Promise<boolean> {
	const parsed = readMarkBody.safeParse(await request.json().catch(() => null));
	return parsed.success;
}

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
	const row = rowForReply(options.store, parsed.data);
	const ticket = row?.tickets.find((item) => item.key === parsed.data.key);
	const pmBot = projectHasPmBot(
		configuration.pmBot,
		row?.key ?? parsed.data.project,
		parsed.data.tracker,
	);
	const picked =
		parsed.data.option === undefined
			? null
			: optionReplyBody(ticket, parsed.data.option, pmBot);
	if (parsed.data.option !== undefined && picked === null) {
		return Response.json({ error: "option not found" }, { status: 400 });
	}
	const text = picked ?? parsed.data.body ?? "";
	if (text.trim() === "") {
		return Response.json({ error: "reply is empty" }, { status: 400 });
	}
	const reply: ReplyRequest = {
		tracker: parsed.data.tracker,
		project: parsed.data.project,
		key: parsed.data.key,
		body: panelReplyBody(ticket, text, pmBot, parsed.data.parentId),
		...(parsed.data.parentId === undefined
			? {}
			: { parentId: parsed.data.parentId }),
		...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
	};
	try {
		const created: PostedReply = await tracker.postReply(reply);
		recordPostedReply(options.store, reply, created);
		notifier.publish({
			overview: runningOverview(options, configuration),
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

function encodeChange(
	encoder: TextEncoder,
	change: Change,
	notifications: boolean,
): Uint8Array[] {
	const frames = [
		encoder.encode(
			`event: overview\ndata: ${JSON.stringify(change.overview)}\n\n`,
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

type PollOptions = {
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

async function poll(options: PollOptions): Promise<Configuration> {
	options.github?.holdLists?.(options.holdLists);
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

function runningOverview(
	options: PollOptions,
	configuration: Configuration,
): Overview {
	const body = overview(options, configuration);
	if (!options.polling) {
		return body;
	}
	return { ...body, polling: true };
}

export async function start(options: StartOptions): Promise<Running> {
	const opened = sqliteStore(options.databasePath);
	const notifier = memoryNotifier();
	const clock = { now: options.now ?? (() => new Date()) };
	const configurationPort = {
		read: () => loadConfiguration(options.configPath),
		write: (text: string) => saveConfiguration(options.configPath, text),
	};
	const restCache = new Map();
	for (const validator of opened.store.readValidators()) {
		rememberValidator(
			restCache,
			validator.url,
			validator.etag,
			JSON.parse(validator.body) as unknown,
			validator.headers,
		);
	}
	const requests = new AbortController();
	const trackerFetch = abortableFetch(options.fetch, requests.signal);
	let configuration: Configuration;
	try {
		configuration = await configurationPort.read();
	} catch (error) {
		opened.close();
		throw error;
	}
	const fetchGithub = installationTokenFetch(
		conditionalFetch(trackerFetch, restCache, opened.store.recordValidator),
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
		token: options.token,
		fetch: trackerFetch,
		fetchGithub,
		restCache,
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
	const testHold = options.fetch.holdLists;
	if (hadRows && testHold !== undefined) {
		pollOptions.holdLists = testHold();
		pollOptions.github?.holdLists?.(pollOptions.holdLists);
	} else if (hadRows) {
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
		pollOptions.github?.holdLists?.(pollOptions.holdLists);
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
		if (polling !== null || !firstPollDone) {
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
			configuration.theme,
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
			return reportFor(pollOptions, configuration, name, true) ?? undefined;
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
						const message =
							error instanceof Error
								? error.message
								: "invalid configuration: configuration";
						return Response.json({ error: message }, { status: 400 });
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
					if (viewOnlyChange(current, merged)) {
						try {
							configuration = await configurationPort.write(mergedText);
						} catch (error) {
							const message =
								error instanceof Error
									? error.message
									: "invalid configuration: configuration";
							return Response.json({ error: message }, { status: 400 });
						}
						pollOptions.fallback = configuration;
						notifier.publish({
							overview: runningOverview(pollOptions, configuration),
							notifications: [],
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
					const trackedChanged = !sameTracked(current.tracked, merged.tracked);
					const stale = polling;
					try {
						configuration = await configurationPort.write(mergedText);
						if (trackedChanged) {
							trackedGeneration += 1;
						}
					} catch (error) {
						const message =
							error instanceof Error
								? error.message
								: "invalid configuration: configuration";
						return Response.json({ error: message }, { status: 400 });
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
					(row) => opened.store.projectError(row.key) === null,
				);
				const projectErrors = rows.map((row) =>
					opened.store.projectError(row.key),
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
