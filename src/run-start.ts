import type { Factory } from "./configuration.ts";
import type { FactoryRun, Queued, RunStart, Ticket } from "./domain.ts";
import { foldKey, githubKeyParts } from "./ticket-key.ts";
import { isRunOf } from "./workcell.ts";

/**
 * A start that the app sent: a ready label that it added, or a claim that a factory took.
 * A claim names the run that the factory accepted, and the runs of the ticket that the factories listed when the app sent it.
 */
export type StartRequest = { at: string } & StartKind;

export type StartKind =
	{ claim: false } | { claim: true; run: string; known: readonly string[] };

/** What a run start reads beyond the ticket: the listed factories, and the last start that the app sent of each ticket. */
export type RunStarts = {
	factories: readonly Factory[];
	/** The last start request that the app sent, by folded ticket key. */
	requests: ReadonlyMap<string, StartRequest>;
};

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
	newestRun: Pick<FactoryRun, "id" | "statusKind" | "submittedAt"> | undefined,
	{ factories, requests }: RunStarts,
): RunStart | { refused: string } {
	const refused = startRefusal(ticket, newestRun);
	if (refused !== undefined) {
		return { refused };
	}
	const claimWaits =
		pendingRequest(ticket, newestRun, requests)?.claim === true;
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
	newestRun: Pick<FactoryRun, "id" | "statusKind" | "submittedAt"> | undefined,
	requests: RunStarts["requests"],
): boolean {
	return (
		newestRun === undefined ||
		(newestRun.statusKind === "succeeded" &&
			pendingRequest(ticket, newestRun, requests) !== undefined)
	);
}

/**
 * The start that the app sent of the ticket when no run started since it.
 * A label start ends at the first run submitted after it. A claim waits until
 * `settledRequests` drops it.
 */
export function pendingRequest(
	ticket: Pick<Ticket, "key">,
	newestRun: Pick<FactoryRun, "id" | "submittedAt"> | undefined,
	requests: RunStarts["requests"],
): StartRequest | undefined {
	const request =
		ticket.key === null ? undefined : requests.get(foldKey(ticket.key));
	return request === undefined ||
		request.claim ||
		newestRun === undefined ||
		Date.parse(request.at) >= Date.parse(newestRun.submittedAt)
		? request
		: undefined;
}

/**
 * The start requests without the claims that a run ended: the accepted run, or
 * any run of the ticket that the factories did not list when the app sent the claim.
 * A factory dates a run by its own clock, and a hub gives a queued start a new id
 * once it sends it to a build machine, possibly before the app reads the accepted id.
 * So a claim ends the first time that a new run of its ticket shows, and stays ended after that.
 */
export function settledRequests(
	requests: ReadonlyMap<string, StartRequest>,
	runs: readonly Pick<FactoryRun, "id" | "key" | "repo">[],
): ReadonlyMap<string, StartRequest> {
	const pending = [...requests].filter(
		([key, request]) =>
			!request.claim ||
			!runs.some(
				(run) =>
					run.id === request.run ||
					(isRunOf(run, key) && !request.known.includes(run.id)),
			),
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
	newestRun: Pick<FactoryRun, "id" | "statusKind" | "submittedAt"> | undefined,
	{ factories, requests }: RunStarts,
): Queued | undefined {
	if (
		ticket.state !== "open" ||
		!waitsForRun(ticket, newestRun, requests) ||
		pendingRequest(ticket, newestRun, requests)?.claim === true
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
