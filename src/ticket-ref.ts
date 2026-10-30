import { type TicketRef, type TrackerKind, trackerKinds } from "./domain.ts";
import { githubTicketRef } from "./github-ticket-ref.ts";
import { linearTicketRef } from "./linear-ticket-ref.ts";

const parsers: Record<
	TrackerKind,
	(token: string, repo: string | null) => TicketRef | null
> = {
	github: githubTicketRef,
	linear: linearTicketRef,
};

/** The ticket that a pasted URL or key names, read by the tracker that owns its form. */
export function parseTicketRef(
	token: string,
	repo: string | null,
): TicketRef | null {
	for (const kind of trackerKinds) {
		const ref = parsers[kind](token, repo);
		if (ref !== null) {
			return ref;
		}
	}
	return null;
}
