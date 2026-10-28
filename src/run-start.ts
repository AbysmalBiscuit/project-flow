import type { Factory } from "./configuration.ts";
import type { FactoryRun, RunStart, Ticket } from "./domain.ts";
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
	const label = factory.readyLabel.toLowerCase();
	const labelled = ticket.labels.some((item) => item.toLowerCase() === label);
	// The hub keeps the ready label on a ticket after its run, so after a run only a
	// start that the app sent later is a request that waits.
	const request =
		ticket.key === null ? undefined : requestedAt.get(foldKey(ticket.key));
	const waits =
		newestRun === undefined ||
		(request !== undefined &&
			Date.parse(request) >= Date.parse(newestRun.submittedAt));
	return {
		factory: factory.name,
		label: factory.readyLabel,
		...(labelled && waits ? { requested: true } : {}),
	};
}

/** The `runStart` field of a ticket view: absent when the ticket refuses a start. */
export function runStartView(
	...args: Parameters<typeof runStartOf>
): { runStart: RunStart } | Record<string, never> {
	const start = runStartOf(...args);
	return "refused" in start ? {} : { runStart: start };
}
