import { type TicketRef, type TrackerKind, trackerKinds } from "./domain.ts";
import { forgejoTicketRef } from "./forgejo-ticket-ref.ts";
import { githubTicketRef } from "./github-ticket-ref.ts";
import { linearTicketRef } from "./linear-ticket-ref.ts";

const parsers: Record<
	TrackerKind,
	(token: string, repo: string | null) => TicketRef | null
> = {
	github: githubTicketRef,
	linear: linearTicketRef,
	forgejo: forgejoTicketRef,
};

/**
 * The ticket that a pasted URL or key names, read by the tracker that owns its
 * form. GitHub and Forgejo keys share a form, so the tracker of the ticket that
 * holds the text reads first.
 */
export function parseTicketRef(
	token: string,
	repo: string | null,
	own: TrackerKind,
): TicketRef | null {
	for (const kind of [own, ...trackerKinds]) {
		const ref = parsers[kind](token, repo);
		if (ref !== null) {
			return ref;
		}
	}
	return null;
}
