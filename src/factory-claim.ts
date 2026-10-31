import type { FactoryEntry } from "./factories.ts";

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
