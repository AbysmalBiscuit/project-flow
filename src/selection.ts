import { useSyncExternalStore } from "react";

import { ticketPath, urlTicket } from "./paths.ts";
import { sameTicket, type TicketRef } from "./ticket-key.ts";

let shown: { href: string; ticket: TicketRef | null } | null = null;
const listeners = new Set<() => void>();

function publish(): void {
	for (const listener of listeners) {
		listener();
	}
}

/** The ticket in the side panel. The page URL holds it, so a reload, the back button and a shared link reopen it. */
export function activeTicket(): TicketRef | null {
	const href = `${window.location.pathname}${window.location.search}`;
	if (shown?.href === href) {
		return shown.ticket;
	}
	shown = { href, ticket: urlTicket(window.location) };
	return shown.ticket;
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
