import { blockerProject, openBlockers, type TicketGraph } from "./blockers.ts";
import type { Configuration } from "./configuration.ts";
import type {
	CrossProjectBlocker,
	FactoryRun,
	LiveRun,
	PullRequest,
	Ticket,
	TicketState,
	TicketView,
	WorkcellRun,
} from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import {
	type categoryColours,
	emptyStatusTypes,
	laneForTicket,
	type placeOnBoard,
	stateOfTicket,
} from "./lanes.ts";
import { ticketRelations } from "./links.ts";
import { linked } from "./pull-links.ts";
import {
	type AutoMergeSources,
	mergesOnItsOwn,
	reviewState,
} from "./review.ts";
import { type RunStarts, runStartView } from "./run-start.ts";
import {
	assigneesOf,
	chipsOf,
	shownFactoryRun,
	shownTicket,
} from "./shown-ticket.ts";
import { asRef, known, parseKey } from "./ticket-index.ts";
import { foldKey, pullId, ticketRefId } from "./ticket-key.ts";
import { progressNamesPull, runFor } from "./workcell.ts";

type TicketWalk = {
	name: string;
	key: string;
	tickets: Ticket[];
	pulls: PullRequest[];
	branches: string[];
	started: Set<string>;
	runs: WorkcellRun[];
	factoryRuns: FactoryRun[];
	autoMerge: AutoMergeSources;
	graph: TicketGraph;
	expectedBots: Map<string, KnownBot[]>;
	states: Configuration["states"];
	stateMapping: NonNullable<Configuration["stateMappings"][string]>;
	runStarts: RunStarts;
	lanes: ReturnType<typeof placeOnBoard>;
	colours: ReturnType<typeof categoryColours>;
	now: Date;
};

/** Reads each ticket of a project once: its shown state, its view, and what the report needs of it. */
export function walkTickets(walk: TicketWalk) {
	const { name, key, tickets, pulls, graph, expectedBots, factoryRuns } = walk;
	const { lanes, colours, autoMerge } = walk;
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
	const tags = new Set<string>();
	const views: TicketView[] = [];
	const relationsByKey = new Map<string, ReturnType<typeof ticketRelations>>();
	const pullByKey = new Map<string, PullRequest>();
	const shownByKey = new Map<string, TicketState>();
	const failedKeys = new Set<string>();
	const blockedRuns = new Map<string, FactoryRun>();
	const runByKey = new Map<string, LiveRun>();
	const cross = new Map<string, CrossProjectBlocker>();
	const linkedByTicket = new Map<string, PullRequest[]>();
	const linkedIds = new Set<string>();
	const subTickets = subTicketCounts(tickets);
	const workcellPulls = new Set(
		factoryRuns.flatMap((run) =>
			run.pull === undefined ? [] : [pullId(run.pull)],
		),
	);
	for (const ticket of tickets) {
		const blockers = openBlockers(ticket, graph);
		const links = linked(ticket, pulls);
		for (const pull of links) {
			linkedIds.add(pullId(pull));
			if (progressNamesPull(ticket.comments ?? [], pull)) {
				workcellPulls.add(pullId(pull));
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
			walk.branches,
			walk.started,
			review,
			walk.runs,
			fed,
			mergesAlone,
			lanes,
			walk.now,
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
			relationsByKey.set(
				foldKey(ticket.key),
				ticketRelations(ticket, blockers, graph),
			);
			const pull = links[0];
			if (pull !== undefined) {
				pullByKey.set(foldKey(ticket.key), pull);
			}
		}
		if (blockers.length > 0 && ticket.state === "open") {
			counts.blocked += 1;
		}
		counts[shown.state] += 1;
		statusTypes[shown.lane.statusType] += 1;
		views.push({
			...ticketView(walk, ticket, shown, lane, blockers, newestRun),
			...countOf(subTickets, ticket.key),
		});
		if (ticket.state === "open") {
			for (const blocker of crossProjectBlockers(
				ticket,
				blockers,
				graph,
				name,
			)) {
				cross.set(ticketRefId(blocker), blocker);
			}
		}
	}
	return {
		counts,
		statusTypes,
		tags,
		views,
		relationsByKey,
		pullByKey,
		shownByKey,
		failedKeys,
		blockedRuns,
		runByKey,
		cross,
		linkedByTicket,
		linkedIds,
		workcellPulls,
	};
}

function ticketView(
	walk: TicketWalk,
	ticket: Ticket,
	shown: ReturnType<typeof shownTicket>,
	lane: ReturnType<typeof laneForTicket>,
	blockers: ReturnType<typeof openBlockers>,
	newestRun: FactoryRun | undefined,
): TicketView {
	const userState = stateOfTicket(
		walk.states,
		walk.stateMapping,
		[lane.name, ...ticket.labels],
		shown.state,
		lane.statusType,
	);
	const shownLane = userState?.label ?? shown.lane.name;
	return {
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
		...shownFactoryRun(ticket, walk.factoryRuns, walk.pulls, walk.now),
		...runStartView(ticket, newestRun, walk.runStarts),
		...(ticket.updatedAt === "" ? {} : { updatedAt: ticket.updatedAt }),
		...assigneesOf(ticket),
		...(ticket.parent === null ? {} : { parent: ticket.parent }),
	};
}

/** The open blockers of a ticket that live in another project. */
function crossProjectBlockers(
	ticket: Ticket,
	blockers: ReturnType<typeof openBlockers>,
	graph: TicketGraph,
	name: string,
): CrossProjectBlocker[] {
	const { index, parsed } = graph;
	const self = asRef(ticket);
	const merged = self === null ? undefined : known(index, self);
	const refs = [
		...(merged?.blockedBy ?? ticket.blockedBy),
		...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
	];
	return blockers.flatMap((blocker) => {
		if (blocker.key === null) {
			return [];
		}
		const source = refs.find(
			(ref) =>
				ref.tracker === blocker.tracker &&
				foldKey(ref.key) === foldKey(blocker.key),
		);
		const project = blockerProject(blocker, source, graph);
		if (project === "" || project.toLowerCase() === name.toLowerCase()) {
			return [];
		}
		return [
			{
				project,
				tracker: blocker.tracker,
				key: blocker.key,
				title: blocker.title,
			},
		];
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
