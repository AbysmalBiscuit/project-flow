import { needsYouItems } from "./attention.ts";
import type { TicketGraph } from "./blockers.ts";
import type { Configuration } from "./configuration.ts";
import type {
	Board,
	FactoryRun,
	FetchStatus,
	NeedsYouItem,
	NeedsYouRules,
	OutsideParent,
	ProjectBody,
	ProjectCounts,
	ProjectReport,
	PullRequest,
	Ticket,
	TicketView,
	WorkcellRun,
} from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import {
	appLaneNames,
	categoryColours,
	lanesFor,
	placeOnBoard,
	stateLanes,
	stateOfTicket,
} from "./lanes.ts";
import { awaitingPull, type PullActionsOf } from "./merge-gate.ts";
import { staleView } from "./poll-merge.ts";
import { settingsKey } from "./project-ref.ts";
import { type ForgeLabelOf, projectReport } from "./report.ts";
import {
	type AutoMergeSources,
	mergesOnItsOwn,
	reviewState,
} from "./review.ts";
import type { RunStarts } from "./run-start.ts";
import { unlinkedPrGroup } from "./terms.ts";
import { known } from "./ticket-index.ts";
import { foldKey, pullId, pullKey, sameTicketKey } from "./ticket-key.ts";
import { walkTickets } from "./ticket-walk.ts";

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
	pullActionsOf: PullActionsOf,
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
		...(state === "awaitingMerge"
			? { awaitingPulls: [awaitingPull(pull, pullActionsOf)] }
			: {}),
		unlinkedPr: true,
		...(pull.host === undefined ? {} : { host: pull.host }),
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
	rules: NeedsYouRules,
	mappings: Pick<Configuration, "laneMappings" | "states" | "stateMappings">,
	runStarts: RunStarts,
	forgeLabelOf: ForgeLabelOf,
	pullActionsOf: PullActionsOf,
	now: Date,
	board?: Board,
): {
	counts: ProjectBody;
	needsYou: NeedsYouItem[];
	report: ProjectReport;
} {
	const { index } = graph;
	const colours = categoryColours(mappings.states);
	const mappingKey = board?.laneKey;
	const mapping =
		mappingKey === undefined ? {} : (mappings.laneMappings[mappingKey] ?? {});
	const stateMapping =
		mappings.stateMappings[stateSourceKey(board, key, autoMerge.projectHost)] ??
		{};
	const lanes = placeOnBoard(
		lanesFor(board, mapping, colours),
		tickets,
		colours,
	);
	const {
		counts,
		statusTypes,
		tags,
		views,
		relationsByKey,
		pullByKey,
		awaitingByKey,
		shownByKey,
		failedKeys,
		blockedRuns,
		runByKey,
		cross,
		linkedByTicket,
		linkedIds,
		workcellPulls,
	} = walkTickets({
		name,
		key,
		tickets,
		pulls,
		branches,
		started: new Set(startedKeys.map((item) => foldKey(item))),
		runs,
		factoryRuns,
		autoMerge,
		graph,
		expectedBots,
		states: mappings.states,
		stateMapping,
		runStarts,
		pullActionsOf,
		lanes,
		colours,
		now,
	});
	const active = pulls.filter((pull) => !pull.merged);
	const unlinked = active.filter((pull) => !linkedIds.has(pullId(pull)));
	const unlinkedPrs = unlinked.map((pull) => ({
		number: pull.number,
		title: pull.title,
		url: pull.url,
		repo: pull.repo,
	}));
	const urlOf = new Map<string | undefined, string | undefined>([
		...pulls.map((pull) => [foldKey(pullKey(pull)), pull.url] as const),
		...tickets.map((ticket) => [foldKey(ticket.key), ticket.url] as const),
	]);
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
		rules,
		autoMerge,
		workcellPulls,
		key,
	).map((item) => {
		const url = urlOf.get(foldKey(item.key));
		return url === undefined ? item : { ...item, url };
	});
	const unlinkedViews = unlinked.map((pull) =>
		unlinkedPrView(
			pull,
			expectedBots,
			mergesOnItsOwn([pull], name, key, autoMerge, workcellPulls),
			mappings.states,
			pullActionsOf,
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
		awaitingByKey,
		needsYouItemsForProject,
		runByKey,
		outsideParents(tickets, graph.groups),
		unlinkedViews,
		(ticket) => known(index, ticket)?.url,
		forgeLabelOf,
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

/**
 * The key that `stateMappings` uses for the statuses of one board. A repo with
 * no lane key takes its `settingsKey`, so each host keeps its own mapping.
 */
export function stateSourceKey(
	board: Board | undefined,
	key: string,
	host: string | undefined,
): string {
	return board?.laneKey ?? settingsKey(key, host);
}
