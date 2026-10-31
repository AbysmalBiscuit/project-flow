import { type TicketRef, type TrackerKind, trackerKinds } from "./domain.ts";
import { forgejoTicketRef } from "./forgejo-ticket-ref.ts";
import { githubTicketRef } from "./github-ticket-ref.ts";
import { gitlabTicketRef } from "./gitlab-ticket-ref.ts";
import { linearTicketRef } from "./linear-ticket-ref.ts";
import type { RefScope } from "./ref-scope.ts";

const parsers: Record<
	TrackerKind,
	(token: string, scope: RefScope) => TicketRef | null
> = {
	github: githubTicketRef,
	linear: linearTicketRef,
	gitlab: gitlabTicketRef,
	forgejo: forgejoTicketRef,
};

/**
 * The ticket that a pasted URL or key names, read by the tracker that owns its
 * form. GitHub and Forgejo keys share a form, so the tracker of the ticket that
 * holds the text reads first.
 */
export function parseTicketRef(
	token: string,
	scope: RefScope,
): TicketRef | null {
	for (const kind of [scope.tracker, ...trackerKinds]) {
		const ref = parsers[kind](token, scope);
		if (ref !== null) {
			return ref;
		}
	}
	return null;
}
