import { useSyncExternalStore } from "react";
import type { NeedsYouItem } from "./domain.ts";

function pagePath(href: string): string {
	const url = new URL(href, window.location.href);
	return `${url.pathname}${url.search}`;
}

export type OpenedTicket = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	item?: NeedsYouItem;
};

let active: OpenedTicket | null = null;
let page = "";
const listeners = new Set<() => void>();

function publish(): void {
	for (const listener of listeners) {
		listener();
	}
}

export function clearTicketOnPageChange(href: string): void {
	const next = pagePath(href);
	if (page === next) {
		return;
	}
	page = next;
	if (active === null) {
		return;
	}
	active = null;
	publish();
}

export function activeTicket(): OpenedTicket | null {
	return active;
}

export function openTicket(ticket: OpenedTicket): void {
	active = ticket;
	publish();
}

export function closeTicket(): void {
	active = null;
	publish();
}

export function replaceActiveItem(item: NeedsYouItem): void {
	if (
		active === null ||
		active.tracker !== item.tracker ||
		active.project !== item.project ||
		active.key !== item.key
	) {
		return;
	}
	active = { ...active, item };
	publish();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useActiveTicket(): OpenedTicket | null {
	return useSyncExternalStore(subscribe, activeTicket, activeTicket);
}
