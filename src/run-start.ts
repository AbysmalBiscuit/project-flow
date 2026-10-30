import type { Factory } from "./configuration.ts";
import type {
	FactoryRun,
	LinearShown,
	LinearSource,
	Queued,
	RunStart,
	Ticket,
} from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import { foldKey, githubKeyParts } from "./ticket-key.ts";
import { isRunOf } from "./workcell.ts";

/**
 * A start that the app sent: a ready label or a Linear state that it wrote, or a claim that a factory took.
 * A written start names the factory of the start, and the runs of the ticket that the factories listed when the app wrote it.
 * A claim names the run that the factory accepted.
 */
export type StartRequest =
	| { claim: false; factory: string; known: readonly string[] }
	| { claim: true; run: string };

/** What a run start reads beyond the ticket: the listed factories, the Linear sources of the hubs, and the last start that the app sent of each ticket. */
export type RunStarts = {
	factories: readonly Factory[];
	linearSources: readonly LinearSource[];
	/** The last start request that the app sent, by folded ticket key. */
	requests: ReadonlyMap<string, StartRequest>;
};

type StartTicket = Pick<
	Ticket,
	"tracker" | "key" | "state" | "labels" | "status"
>;

type Refused = { refused: string };

/**
 * True when a factory takes a claimed start: it answers, it reports its run slots,
 * and no hub reads its runs, because a box takes its runs from that hub.
 */
export function takesClaim(
	entry: Pick<FactoryEntry, "reachable" | "slots" | "alsoReadThroughHub">,
): boolean {
	return (
		entry.reachable === true &&
		entry.slots !== undefined &&
		entry.alsoReadThroughHub === undefined
	);
}

/** Why a ticket cannot start a run: it is closed, or it has a run that did not succeed. */
export function startRefusal(
	ticket: Pick<Ticket, "state">,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
): string | undefined {
	if (ticket.state !== "open") {
		return "the ticket is closed";
	}
	if (newestRun !== undefined && newestRun.statusKind !== "succeeded") {
		return "the ticket already has a run";
	}
	return undefined;
}

/**
 * How an open ticket with no run, or whose newest run succeeded, starts a run.
 * A Linear ticket gets the state and labels of its hub source. On GitHub, the first
 * factory with a ready label gives the label start. The hub source loop then claims the ticket.
 * A GitHub ticket can also start through a claim on a factory, with or without a ready label.
 */
export function runStartOf(
	ticket: StartTicket,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	{ factories, linearSources, requests }: RunStarts,
): RunStart | Refused {
	const refused = startRefusal(ticket, newestRun);
	if (refused !== undefined) {
		return { refused };
	}
	if (ticket.tracker === "linear") {
		const start = linearStart(ticket, linearSources);
		if ("refused" in start) {
			return start;
		}
		const waits =
			shows(ticket, start) && waitsForRun(ticket, newestRun, requests);
		return { ...start, ...(waits ? { requested: true } : {}) };
	}
	const claimWaits = pendingRequest(ticket, requests)?.claim === true;
	const factory = factories.find((item) => item.readyLabel !== undefined);
	if (factory?.readyLabel === undefined) {
		return factories.length > 0 &&
			ticket.key !== null &&
			githubKeyParts(ticket.key) !== null
			? claimWaits
				? { requested: true }
				: {}
			: { refused: "no factory has a ready label" };
	}
	const waits =
		(hasLabel(ticket, factory.readyLabel) &&
			waitsForRun(ticket, newestRun, requests)) ||
		claimWaits;
	return {
		factory: factory.name,
		label: factory.readyLabel,
		...(waits ? { requested: true } : {}),
	};
}

type LinearStart = { factory: string } & LinearShown;

/** The state name that a hub source reads as ready for a run. */
const readyState = "Ready";

/**
 * The ready state, as the hub source of the ticket's team shows it, plus the
 * labels of the first ready rule that does not exclude the ticket.
 */
function linearStart(
	ticket: StartTicket,
	sources: RunStarts["linearSources"],
): LinearStart | Refused {
	const team = ticket.key?.split("-")[0]?.toLowerCase();
	const [source, ...others] = sources.filter(
		(item) => item.team.toLowerCase() === team,
	);
	if (source === undefined || others.length > 0) {
		return { refused: "no one hub source has the team of the ticket" };
	}
	const rule = source.rules.find(
		({ state, without }) =>
			state === readyState && !without.some((label) => hasLabel(ticket, label)),
	);
	if (rule === undefined) {
		return { refused: "no ready rule of the hub source takes the ticket" };
	}
	const shown = source.linearStates[readyState] ?? {
		state: readyState,
		add: [],
		remove: [],
	};
	return {
		factory: source.factory,
		state: shown.state,
		add: [...new Set([...shown.add, ...rule.labels])],
		remove: shown.remove,
	};
}

/** True when the ticket already shows what the Linear start writes. */
function shows(ticket: StartTicket, start: LinearStart): boolean {
	return (
		ticket.status?.name.toLowerCase() === start.state.toLowerCase() &&
		start.add.every((label) => hasLabel(ticket, label)) &&
		!start.remove.some((label) => hasLabel(ticket, label))
	);
}

function hasLabel(ticket: Pick<Ticket, "labels">, label: string): boolean {
	const folded = label.toLowerCase();
	return ticket.labels.some((item) => item.toLowerCase() === folded);
}

/**
 * True when no run of the ticket started since its ready condition asked for one.
 * The hub keeps the ready label on a ticket after its run, so after a run only a
 * start that the app sent later is a request that waits.
 */
function waitsForRun(
	ticket: Pick<Ticket, "key">,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	requests: RunStarts["requests"],
): boolean {
	return (
		newestRun === undefined ||
		(newestRun.statusKind === "succeeded" &&
			pendingRequest(ticket, requests) !== undefined)
	);
}

/** The start that the app sent of the ticket, until `settledRequests` drops it. */
export function pendingRequest(
	ticket: Pick<Ticket, "key">,
	requests: RunStarts["requests"],
): StartRequest | undefined {
	return ticket.key === null ? undefined : requests.get(foldKey(ticket.key));
}

type StartedRun = Pick<
	FactoryRun,
	"id" | "key" | "repo" | "sourceFactory" | "queuedId"
>;

type StartEntry = Pick<FactoryEntry, "name" | "alsoReadThroughHub">;

/**
 * True when `run` is the run of the start. A claim ends at its accepted run,
 * which a hub renames and lists with the accepted id as `queuedId` once it sends it.
 * A label start ends at a new run of its ticket that a hub source of the label's factory started.
 * A hub that also reads the box of the label shows the run under the name of the hub.
 * Factories date runs by their own clocks, so the rules compare ids and no times.
 */
function startedBy(
	run: StartedRun,
	key: string,
	request: StartRequest,
	entries: readonly StartEntry[],
) {
	if (request.claim) {
		return run.id === request.run || run.queuedId === request.run;
	}
	const hub = entries.find(
		({ name }) => name === request.factory,
	)?.alsoReadThroughHub;
	return (
		isRunOf(run, key) &&
		run.sourceFactory !== undefined &&
		(run.sourceFactory === request.factory || run.sourceFactory === hub) &&
		!request.known.includes(run.id)
	);
}

/** The start requests without the ones that their run ended. A start stays ended after that. */
export function settledRequests(
	requests: ReadonlyMap<string, StartRequest>,
	runs: readonly StartedRun[],
	entries: readonly StartEntry[],
): ReadonlyMap<string, StartRequest> {
	const pending = [...requests].filter(
		([key, request]) =>
			!runs.some((run) => startedBy(run, key, request, entries)),
	);
	return pending.length === requests.size ? requests : new Map(pending);
}

/**
 * The factory that claims an open ticket while no run of it started.
 * A Linear ticket is queued when it shows what the Linear start writes, so the
 * hub source rule decides it. On GitHub, the first factory whose ready condition
 * the ticket meets queues it. A factory with both a ready label and a ready status
 * needs both. A pending claim names its own factory, so the ready condition of
 * another factory does not queue the ticket.
 */
export function queuedOf(
	ticket: StartTicket,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	{ factories, linearSources, requests }: RunStarts,
): Queued | undefined {
	if (
		ticket.state !== "open" ||
		!waitsForRun(ticket, newestRun, requests) ||
		pendingRequest(ticket, requests)?.claim === true
	) {
		return undefined;
	}
	if (ticket.tracker === "linear") {
		const start = linearStart(ticket, linearSources);
		return "refused" in start || !shows(ticket, start)
			? undefined
			: { factory: start.factory, status: start.state };
	}
	const status = ticket.status?.name.toLowerCase();
	const factory = factories.find(
		({ readyLabel, readyStatus }) =>
			(readyLabel !== undefined || readyStatus !== undefined) &&
			(readyLabel === undefined || hasLabel(ticket, readyLabel)) &&
			(readyStatus === undefined || readyStatus.toLowerCase() === status),
	);
	return factory === undefined
		? undefined
		: {
				factory: factory.name,
				...(factory.readyLabel === undefined
					? {}
					: { label: factory.readyLabel }),
				...(factory.readyStatus === undefined
					? {}
					: { status: factory.readyStatus }),
			};
}

/**
 * The `runStart` and `queued` fields of a ticket view. Each is absent when the
 * ticket refuses a start, or does not wait for a run.
 */
export function runStartView(
	ticket: StartTicket,
	newestRun: Parameters<typeof queuedOf>[1],
	runStarts: RunStarts,
): { runStart?: RunStart; queued?: Queued } {
	const start = runStartOf(ticket, newestRun, runStarts);
	const queued = queuedOf(ticket, newestRun, runStarts);
	return {
		...("refused" in start ? {} : { runStart: start }),
		...(queued === undefined ? {} : { queued }),
	};
}
