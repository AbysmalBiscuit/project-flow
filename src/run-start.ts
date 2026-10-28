import type { Factory } from "./configuration.ts";
import type { FactoryRun, RunStart, Ticket } from "./domain.ts";

/**
 * The ready label that starts a run of an open ticket with no run, or whose newest run succeeded.
 * The first factory with a ready label gives it. The hub source loop then claims the ticket.
 */
export function runStartOf(
	ticket: Pick<Ticket, "state" | "labels">,
	newestRun: Pick<FactoryRun, "statusKind"> | undefined,
	factories: readonly Factory[],
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
	return {
		factory: factory.name,
		label: factory.readyLabel,
		...(ticket.labels.some((item) => item.toLowerCase() === label)
			? { requested: true }
			: {}),
	};
}

/** The `runStart` field of a ticket view: absent when the ticket refuses a start. */
export function runStartView(
	...args: Parameters<typeof runStartOf>
): { runStart: RunStart } | Record<string, never> {
	const start = runStartOf(...args);
	return "refused" in start ? {} : { runStart: start };
}
