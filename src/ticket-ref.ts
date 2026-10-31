import { type TicketRef, type TrackerKind, trackerKinds } from "./domain.ts";
import { githubTicketRef, githubTicketUrl } from "./github-ticket-ref.ts";
import { linearTicketRef, linearTicketUrl } from "./linear-ticket-ref.ts";

type TicketForm = {
	/** The ticket that a pasted URL or key names, or null for another form. */
	parse: (token: string, repo: string | null) => TicketRef | null;
	/** The web page of the ticket with `key`. */
	url: (key: string) => string | undefined;
};

const forms: Record<TrackerKind, TicketForm> = {
	github: { parse: githubTicketRef, url: githubTicketUrl },
	linear: { parse: linearTicketRef, url: linearTicketUrl },
};

/** The ticket that a pasted URL or key names, read by the tracker that owns its form. */
export function parseTicketRef(
	token: string,
	repo: string | null,
): TicketRef | null {
	for (const kind of trackerKinds) {
		const ref = forms[kind].parse(token, repo);
		if (ref !== null) {
			return ref;
		}
	}
	return null;
}

/** The `url` field of a ticket view: the ticket's page on its tracker, or nothing when the key names no page. */
export function ticketUrl(
	tracker: TrackerKind,
	key: string | null,
): { url?: string } {
	const url = key === null ? undefined : forms[tracker].url(key);
	return url === undefined ? {} : { url };
}
