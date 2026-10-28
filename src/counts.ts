import { needsYouItems } from "./attention.ts";
import { blockerProject, openBlockers, type TicketGraph } from "./blockers.ts";
import type { Configuration } from "./configuration.ts";
import type {
	Board,
	CrossProjectBlocker,
	FactoryRun,
	FetchStatus,
	LiveRun,
	NeedsYouItem,
	NeedsYouRules,
	OutsideParent,
	ProjectBody,
	ProjectCounts,
	ProjectReport,
	PullRequest,
	Ticket,
	TicketState,
	TicketView,
	WorkcellRun,
} from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import {
	appLaneNames,
	categoryColours,
	emptyStatusTypes,
	laneForTicket,
	lanesFor,
	placeOnBoard,
	stateLanes,
	stateOfTicket,
} from "./lanes.ts";
import { ticketRelations } from "./links.ts";
import { projectHasPmBot } from "./open-ask.ts";
import { staleView } from "./poll-merge.ts";
import { linked } from "./pull-links.ts";
import { projectReport } from "./report.ts";
import {
	type AutoMergeSources,
	mergesOnItsOwn,
	reviewState,
} from "./review.ts";
import { runStartView } from "./run-start.ts";
import {
	assigneesOf,
	chipsOf,
	shownFactoryRun,
	shownTicket,
} from "./shown-ticket.ts";
import { unlinkedPrGroup } from "./terms.ts";
import { asRef, known, parseKey } from "./ticket-index.ts";
import { foldKey, pullKey, sameTicketKey, ticketRefId } from "./ticket-key.ts";
import { progressNamesPull, runFor } from "./workcell.ts";

/** The state of an unlinked PR from its review cycle, as for the PR of a ticket. */
function unlinkedPrState(
	pull: PullRequest,
	expectedBots: Map<string, KnownBot[]>,
	mergesAlone: boolean,
): "inProgress" | "inReview" | "awaitingMerge" {
	const review = reviewState([pull], expectedBots, []).state;
	if (review === null) {
		return "inProgress";
	}
	return review === "awaitingMerge" && mergesAlone ? "inReview" : review;
}

/** The card of an unlinked PR, in the lane of its state and in the "Unlinked PRs" group. */
function unlinkedPrView(
	pull: PullRequest,
	expectedBots: Map<string, KnownBot[]>,
	mergesAlone: boolean,
	states: Configuration["states"],
): TicketView {
	const state = unlinkedPrState(pull, expectedBots, mergesAlone);
	return {
		key: pullKey(pull),
		title: pull.title,
		state,
		blockers: [],
		lane:
			stateOfTicket(states, {}, [], state, state)?.label ?? appLaneNames[state],
		statusType: state,
		pull: pullKey(pull),
		pullUrl: pull.url,
		unlinkedPr: true,
		workstream: unlinkedPrGroup,
		workstreamKey: unlinkedPrGroup,
		theme: unlinkedPrGroup,
		themeGroup: unlinkedPrGroup,
	};
}

export function projectCounts(
	name: string,
	key: string,
	tracker: ProjectCounts["tracker"],
	tickets: Ticket[],
	pulls: PullRequest[],
	branches: string[],
	startedKeys: string[],
	runs: WorkcellRun[],
	factoryRuns: FactoryRun[],
	autoMerge: AutoMergeSources,
	graph: TicketGraph,
	expectedBots: Map<string, KnownBot[]>,
	status: FetchStatus,
	rules: Omit<NeedsYouRules, "pmBot"> & {
		pmBot: Record<string, boolean>;
	},
	mappings: Pick<
		Configuration,
		"laneMappings" | "states" | "stateMappings" | "factories"
	>,
	now: Date,
	board?: Board,
): {
	counts: ProjectBody;
	needsYou: NeedsYouItem[];
	report: ProjectReport;
} {
	const { index, parsed } = graph;
	const counts = {
		done: 0,
		dropped: 0,
		blocked: 0,
		backlog: 0,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
	};
	const statusTypes = emptyStatusTypes();
	const colours = categoryColours(mappings.states);
	const mappingKey = board?.laneKey;
	const mapping =
		mappingKey === undefined ? {} : (mappings.laneMappings[mappingKey] ?? {});
	const stateMapping = mappings.stateMappings[stateSourceKey(board, key)] ?? {};
	const lanes = placeOnBoard(
		lanesFor(board, mapping, colours),
		tickets,
		colours,
	);
	const tags = new Set<string>();
	const views: TicketView[] = [];
	const relationsByKey = new Map<string, ReturnType<typeof ticketRelations>>();
	const pullByKey = new Map<string, PullRequest>();
	const shownByKey = new Map<string, TicketState>();
	const failedKeys = new Set<string>();
	const blockedRuns = new Map<string, FactoryRun>();
	const runByKey = new Map<string, LiveRun>();
	const cross = new Map<string, CrossProjectBlocker>();
	const active = pulls.filter((pull) => !pull.merged);
	const linkedByTicket = new Map<string, PullRequest[]>();
	const linkedKeys = new Set<string>();
	const subTickets = subTicketCounts(tickets);
	const started = new Set(startedKeys.map((item) => foldKey(item)));
	const workcellPulls = new Set(
		factoryRuns.flatMap((run) =>
			run.pull === undefined ? [] : [pullKey(run.pull)],
		),
	);
	for (const ticket of tickets) {
		const blockers = openBlockers(ticket, graph);
		const links = linked(ticket, pulls);
		for (const pull of links) {
			linkedKeys.add(pullKey(pull));
			if (progressNamesPull(ticket.comments ?? [], pull)) {
				workcellPulls.add(pullKey(pull));
			}
		}
		if (ticket.state === "open" && ticket.key !== null) {
			linkedByTicket.set(ticket.key, links);
		}
		const review = reviewState(links, expectedBots, ticket.comments ?? []);
		for (const tag of review.tags) {
			tags.add(tag);
		}
		const lane = laneForTicket(ticket, lanes, colours);
		const mergesAlone = mergesOnItsOwn(
			links,
			name,
			key,
			autoMerge,
			workcellPulls,
		);
		const newestRun = runFor(ticket, factoryRuns);
		const fed = newestRun?.coveredByFeed === true ? newestRun : undefined;
		const shown = shownTicket(
			ticket,
			lane,
			links,
			branches,
			started,
			review,
			runs,
			fed,
			mergesAlone,
			lanes,
			now,
			blockers.length,
		);
		if (ticket.key !== null) {
			shownByKey.set(ticket.key, shown.state);
			if (shown.runFailed) {
				failedKeys.add(ticket.key);
			}
			if (fed?.statusKind === "blocked") {
				blockedRuns.set(ticket.key, fed);
			}
			if (shown.run !== undefined) {
				runByKey.set(foldKey(ticket.key), shown.run);
			}
		}
		if (blockers.length > 0 && ticket.state === "open") {
			counts.blocked += 1;
		}
		counts[shown.state] += 1;
		statusTypes[shown.lane.statusType] += 1;
		if (ticket.key !== null) {
			relationsByKey.set(
				foldKey(ticket.key),
				ticketRelations(ticket, blockers, graph),
			);
			const pull = links[0];
			if (pull !== undefined) {
				pullByKey.set(foldKey(ticket.key), pull);
			}
		}
		const userState = stateOfTicket(
			mappings.states,
			stateMapping,
			[lane.name, ...ticket.labels],
			shown.state,
			lane.statusType,
		);
		const shownLane = userState?.label ?? shown.lane.name;
		views.push({
			key: ticket.key,
			title: ticket.title,
			state: shown.state,
			blockers: blockers.flatMap((blocker) =>
				blocker.key === null ? [] : [blocker.key],
			),
			lane: shownLane,
			...(shown.lane.name === shownLane ? {} : { status: shown.lane.name }),
			statusType: shown.lane.statusType,
			...(blockers.length > 0 && ticket.state === "open"
				? { blocked: true }
				: {}),
			...(shown.staleStatus === undefined
				? {}
				: { staleStatus: shown.staleStatus }),
			...chipsOf(shown),
			enteredStateAt: shown.enteredStateAt,
			...shownFactoryRun(ticket, factoryRuns, pulls, now),
			...runStartView(ticket, newestRun, mappings.factories),
			...(ticket.updatedAt === "" ? {} : { updatedAt: ticket.updatedAt }),
			...assigneesOf(ticket),
			...(ticket.parent === null ? {} : { parent: ticket.parent }),
			...countOf(subTickets, ticket.key),
		});
		if (blockers.length === 0 || ticket.state !== "open") {
			continue;
		}
		for (const blocker of blockers) {
			if (blocker.key === null) {
				continue;
			}
			const self = asRef(ticket);
			const merged = self === null ? undefined : known(index, self);
			const source = [
				...(merged?.blockedBy ?? ticket.blockedBy),
				...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
			].find(
				(ref) =>
					ref.tracker === blocker.tracker &&
					foldKey(ref.key) === foldKey(blocker.key),
			);
			const project = blockerProject(blocker, source, graph);
			if (project === "" || project.toLowerCase() === name.toLowerCase()) {
				continue;
			}
			const crossBlocker = {
				project,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title,
			};
			cross.set(ticketRefId(crossBlocker), crossBlocker);
		}
	}
	const unlinked = active.filter((pull) => !linkedKeys.has(pullKey(pull)));
	const unlinkedPrs = unlinked.map((pull) => ({
		number: pull.number,
		title: pull.title,
		url: pull.url,
		repo: pull.repo,
	}));
	const needsYouItemsForProject = needsYouItems(
		name,
		tracker,
		tickets,
		active,
		unlinked,
		linkedByTicket,
		expectedBots,
		shownByKey,
		failedKeys,
		blockedRuns,
		{
			labels: rules.labels,
			viewerLogins: rules.viewerLogins,
			pmBot: projectHasPmBot(rules.pmBot, key, tracker),
		},
		autoMerge,
		workcellPulls,
		key,
	);
	const unlinkedViews = unlinked.map((pull) =>
		unlinkedPrView(
			pull,
			expectedBots,
			mergesOnItsOwn([pull], name, key, autoMerge, workcellPulls),
			mappings.states,
		),
	);
	const unlinkedReview = reviewState(unlinked, expectedBots, []);
	for (const tag of unlinkedReview.tags) {
		tags.add(tag);
	}
	const project: ProjectBody = {
		name,
		tracker,
		...counts,
		unlinkedPrs,
		tickets: withSubTicketCounts(views),
		crossProjectBlockers: [...cross.values()],
		needsYou: needsYouItemsForProject.length,
		progress: progressRatio(counts),
		...staleView(status, status.fetchedAt),
		tags: [...tags],
		statusTypes,
	};
	const report = projectReport(
		project,
		tickets,
		stateLanes(mappings.states),
		lanes,
		relationsByKey,
		pullByKey,
		needsYouItemsForProject,
		runByKey,
		outsideParents(tickets, graph.groups),
		unlinkedViews,
	);
	return {
		counts: project,
		needsYou: needsYouItemsForProject,
		report,
	};
}

function withSubTicketCounts(views: TicketView[]): TicketView[] {
	const subTicketsByKey = new Map<string, TicketView[]>();
	for (const view of views) {
		const parent = foldKey(view.parent);
		if (parent === undefined || parent === foldKey(view.key)) {
			continue;
		}
		subTicketsByKey.set(parent, [...(subTicketsByKey.get(parent) ?? []), view]);
	}
	const subTicketsOf = (view: TicketView) =>
		view.key === null ? [] : (subTicketsByKey.get(foldKey(view.key)) ?? []);
	const settled = new Map<TicketView, boolean>();
	const allClosed = (view: TicketView): boolean => {
		const known = settled.get(view);
		if (known !== undefined) {
			return known;
		}
		settled.set(view, true);
		const result = subTicketsOf(view).every(
			(sub) =>
				(sub.statusType === "done" || sub.statusType === "dropped") &&
				allClosed(sub),
		);
		settled.set(view, result);
		return result;
	};
	return views.map((view) => {
		const below = subTicketsOf(view);
		if (below.length === 0) {
			return view;
		}
		return {
			...view,
			subTicketsDone: below.filter((sub) => sub.statusType === "done").length,
			...(allClosed(view) ? { startsCollapsed: true as const } : {}),
		};
	});
}

function subTicketCounts(tickets: Ticket[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const ticket of tickets) {
		if (ticket.parent !== null) {
			const key = foldKey(ticket.parent);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}

function countOf(
	counts: Map<string, number>,
	key: string | null,
): { subTickets?: number } {
	const count = key === null ? undefined : counts.get(foldKey(key));
	return count === undefined ? {} : { subTickets: count };
}

function outsideParents(
	tickets: Ticket[],
	all: { project: string; tickets: Ticket[] }[],
): OutsideParent[] {
	const own = new Set(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [foldKey(ticket.key)],
		),
	);
	const found = new Map<string, OutsideParent>();
	for (const ticket of tickets) {
		const key = ticket.parent;
		const details = ticket.parentDetails;
		if (key === null || details === undefined || own.has(foldKey(key))) {
			continue;
		}
		const home =
			all.find((group) =>
				group.tickets.some(
					(other) => other.key !== null && sameTicketKey(other.key, key),
				),
			)?.project ??
			all.find(
				(group) =>
					details.project !== "" &&
					group.project.toLowerCase() === details.project.toLowerCase(),
			)?.project;
		found.set(foldKey(key), {
			tracker: ticket.tracker,
			project: home ?? details.project,
			key,
			title: details.title.trim() || key,
			...(details.state === undefined ? {} : { state: details.state }),
			url: details.url,
			tracked: home !== undefined,
		});
	}
	return [...found.values()];
}

const stateKeys = [
	"done",
	"dropped",
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
] as const;

function progressRatio(
	counts: Pick<ProjectCounts, (typeof stateKeys)[number]>,
): number {
	const total = stateKeys.reduce((sum, state) => sum + counts[state], 0);
	if (total === 0) {
		return 0;
	}
	return Math.round((counts.done / total) * 100);
}

/** The key that `stateMappings` uses for the statuses of one board. */
export function stateSourceKey(board: Board | undefined, key: string): string {
	return board?.laneKey ?? key;
}
