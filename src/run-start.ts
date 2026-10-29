import type { Factory } from "./configuration.ts";
import type { FactoryRun, Queued, RunStart, Ticket } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import { foldKey, githubKeyParts } from "./ticket-key.ts";
import { isRunOf } from "./workcell.ts";

/**
 * A start that the app sent: a ready label that it added, or a claim that a factory took.
 * A label start names the factory of the label, and the runs of the ticket that the factories listed when the app added it.
 * A claim names the run that the factory accepted.
 */
export type StartRequest =
	| { claim: false; factory: string; known: readonly string[] }
	| { claim: true; run: string };

/** What a run start reads beyond the ticket: the listed factories, and the last start that the app sent of each ticket. */
export type RunStarts = {
	factories: readonly Factory[];
	/** The last start request that the app sent, by folded ticket key. */
	requests: ReadonlyMap<string, StartRequest>;
};

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
 * The first factory with a ready label gives the label start. The hub source loop then claims the ticket.
 * A GitHub ticket can also start through a claim on a factory, with or without a ready label.
 */
export function runStartOf(
	ticket: Pick<Ticket, "key" | "state" | "labels">,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	{ factories, requests }: RunStarts,
): RunStart | { refused: string } {
	const refused = startRefusal(ticket, newestRun);
	if (refused !== undefined) {
		return { refused };
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

/**
 * True when `run` is the run of the start. A claim ends at its accepted run,
 * which a hub renames and lists with the accepted id as `queuedId` once it sends it.
 * A label start ends at a new run of its ticket that a hub source of the label's factory started.
 * Factories date runs by their own clocks, so the rules compare ids and no times.
 */
function startedBy(run: StartedRun, key: string, request: StartRequest) {
	return request.claim
		? run.id === request.run || run.queuedId === request.run
		: isRunOf(run, key) &&
				run.sourceFactory === request.factory &&
				!request.known.includes(run.id);
}

/** The start requests without the ones that their run ended. A start stays ended after that. */
export function settledRequests(
	requests: ReadonlyMap<string, StartRequest>,
	runs: readonly StartedRun[],
): ReadonlyMap<string, StartRequest> {
	const pending = [...requests].filter(
		([key, request]) => !runs.some((run) => startedBy(run, key, request)),
	);
	return pending.length === requests.size ? requests : new Map(pending);
}

/**
 * The first factory whose ready condition an open ticket meets while no run of it started.
 * A factory with both a ready label and a ready status needs both. A pending claim names
 * its own factory, so the ready condition of another factory does not queue the ticket.
 */
export function queuedOf(
	ticket: Pick<Ticket, "key" | "state" | "labels" | "status">,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	{ factories, requests }: RunStarts,
): Queued | undefined {
	if (
		ticket.state !== "open" ||
		!waitsForRun(ticket, newestRun, requests) ||
		pendingRequest(ticket, requests)?.claim === true
	) {
		return undefined;
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
	ticket: Parameters<typeof queuedOf>[0],
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
