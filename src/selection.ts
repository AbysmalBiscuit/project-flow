import { useSyncExternalStore } from "react";

import { type TicketLink, ticketPath, urlTicket } from "./paths.ts";
import { sameTicket, type TicketRef } from "./ticket-key.ts";

type ShownLink = {
	href: string;
	ticket: TicketRef | null;
	/** A ticket link with no tracker that the API names, until the report of its project names one. */
	unresolved: Omit<TicketLink, "tracker"> | null;
};

let shown: ShownLink | null = null;
const knownTrackers = new Set<TicketRef["tracker"]>();
const listeners = new Set<() => void>();

function publish(): void {
	for (const listener of listeners) {
		listener();
	}
}

function shownLink(): ShownLink {
	const href = `${window.location.pathname}${window.location.search}`;
	if (shown?.href === href) {
		return shown;
	}
	const link = urlTicket(window.location);
	const tracker =
		[...knownTrackers].find((known) => known === link?.tracker) ?? null;
	shown = {
		href,
		ticket:
			link === null || tracker === null
				? null
				: { tracker, project: link.project, key: link.key },
		unresolved:
			link !== null && tracker === null
				? { project: link.project, key: link.key }
				: null,
	};
	return shown;
}

/** Adds tracker kinds that the API names. A ticket link can name only these. */
export function knowTrackers(kinds: readonly TicketRef["tracker"][]): void {
	for (const kind of kinds) {
		knownTrackers.add(kind);
	}
	shown = null;
	publish();
}

/** The ticket in the side panel. The page URL holds it, so a reload, the back button and a shared link reopen it. */
export function activeTicket(): TicketRef | null {
	return shownLink().ticket;
}

function unresolvedLink(): ShownLink["unresolved"] {
	return shownLink().unresolved;
}

/** True when the page URL names a ticket, also before the API names its tracker. */
export function hasTicketLink(): boolean {
	return activeTicket() !== null || unresolvedLink() !== null;
}

function writeTicket(
	ticket: TicketRef | null,
	history: "push" | "replace",
): void {
	const next = ticketPath(
		`${window.location.pathname}${window.location.search}${window.location.hash}`,
		ticket,
	);
	if (history === "push") {
		window.history.pushState(null, "", next);
	} else {
		window.history.replaceState(window.history.state, "", next);
	}
}

/** Opens the ticket in the panel. A replace keeps the back button on the page before it. */
export function openTicket(
	ticket: TicketRef,
	history: "push" | "replace" = "push",
): void {
	knownTrackers.add(ticket.tracker);
	shown = null;
	const current = activeTicket();
	if (current === null || !sameTicket(current, ticket)) {
		writeTicket(
			{ tracker: ticket.tracker, project: ticket.project, key: ticket.key },
			history,
		);
	}
	publish();
}

export function closeTicket(): void {
	if (activeTicket() !== null) {
		writeTicket(null, "push");
	}
	publish();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener("popstate", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("popstate", listener);
	};
}

export function useActiveTicket(): TicketRef | null {
	return useSyncExternalStore(subscribe, activeTicket, activeTicket);
}

export function useUnresolvedLink(): ShownLink["unresolved"] {
	return useSyncExternalStore(subscribe, unresolvedLink, unresolvedLink);
}
