import type { Factory } from "./configuration.ts";
import type { FactoryRun, Queued, RunStart, Ticket } from "./domain.ts";
import { foldKey } from "./ticket-key.ts";

/** What a run start reads beyond the ticket: the listed factories, and when the app last requested a start of each ticket. */
export type RunStarts = {
	factories: readonly Factory[];
	/** The time of the last start request that the app sent, by folded ticket key. */
	requestedAt: ReadonlyMap<string, string>;
};

/**
 * The ready label that starts a run of an open ticket with no run, or whose newest run succeeded.
 * The first factory with a ready label gives it. The hub source loop then claims the ticket.
 */
export function runStartOf(
	ticket: Pick<Ticket, "key" | "state" | "labels">,
	newestRun: Pick<FactoryRun, "statusKind" | "submittedAt"> | undefined,
	{ factories, requestedAt }: RunStarts,
): RunStart | { refused: string } {
	if (ticket.state !== "open") {
		return { refused: "the ticket is closed" };
	}
	if (newestRun !== undefined && newestRun.statusKind !== "succeeded") {
		return { refused: "the ticket already has a run" };
	}
	const factory = factories.find((item) => item.readyLabel !== undefined);
	if (factory?.readyLabel === undefined) {
		return { refused: "no factory has a ready label" };
	}
	const waits =
		hasLabel(ticket, factory.readyLabel) &&
		waitsForRun(ticket, newestRun, requestedAt);
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
	newestRun: Pick<FactoryRun, "statusKind" | "submittedAt"> | undefined,
	requestedAt: RunStarts["requestedAt"],
): boolean {
	if (newestRun === undefined) {
		return true;
	}
	const request =
		ticket.key === null ? undefined : requestedAt.get(foldKey(ticket.key));
	return (
		newestRun.statusKind === "succeeded" &&
		request !== undefined &&
		Date.parse(request) >= Date.parse(newestRun.submittedAt)
	);
}

/**
 * The first factory whose ready condition an open ticket meets while no run of it started.
 * A factory with both a ready label and a ready status needs both.
 */
export function queuedOf(
	ticket: Pick<Ticket, "key" | "state" | "labels" | "status">,
	newestRun: Pick<FactoryRun, "statusKind" | "submittedAt"> | undefined,
	{ factories, requestedAt }: RunStarts,
): Queued | undefined {
	if (ticket.state !== "open" || !waitsForRun(ticket, newestRun, requestedAt)) {
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
