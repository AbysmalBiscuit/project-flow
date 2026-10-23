import { useSyncExternalStore } from "react";
import type { NeedsYouItem } from "./domain.ts";
import { ticketPath, urlTicket } from "./paths.ts";
import { sameTicket, type TicketRef } from "./ticket-key.ts";

/** The ticket in the side panel. The page URL holds it, so a reload, the back button and a shared link reopen it. */
export type OpenedTicket = TicketRef & { item?: NeedsYouItem };

let item: NeedsYouItem | null = null;
let shown: {
	href: string;
	item: NeedsYouItem | null;
	ticket: OpenedTicket | null;
} | null = null;
const listeners = new Set<() => void>();

function publish(): void {
	for (const listener of listeners) {
		listener();
	}
}

export function activeTicket(): OpenedTicket | null {
	const href = `${window.location.pathname}${window.location.search}`;
	if (shown?.href === href && shown.item === item) {
		return shown.ticket;
	}
	const ref = urlTicket(window.location);
	const ticket =
		ref !== null && item !== null && sameTicket(item, ref)
			? { ...ref, item }
			: ref;
	shown = { href, item, ticket };
	return ticket;
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
	ticket: OpenedTicket,
	history: "push" | "replace" = "push",
): void {
	const current = activeTicket();
	item = ticket.item ?? null;
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
	item = null;
	publish();
}

export function replaceActiveItem(next: NeedsYouItem): void {
	const current = activeTicket();
	if (current === null || !sameTicket(current, next)) {
		return;
	}
	item = next;
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

export function useActiveTicket(): OpenedTicket | null {
	return useSyncExternalStore(subscribe, activeTicket, activeTicket);
}
