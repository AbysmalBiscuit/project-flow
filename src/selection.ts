import { useSyncExternalStore } from "react";
import type { NeedsYouItem } from "./domain.ts";

export type OpenedTicket = {
	project: string;
	tracker: "github" | "linear";
	key: string;
	item?: NeedsYouItem;
};

let active: OpenedTicket | null = null;
const listeners = new Set<() => void>();

export function activeTicket(): OpenedTicket | null {
	return active;
}

export function openTicket(ticket: OpenedTicket): void {
	active = ticket;
	for (const listener of listeners) {
		listener();
	}
}

export function closeTicket(): void {
	active = null;
	for (const listener of listeners) {
		listener();
	}
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
	for (const listener of listeners) {
		listener();
	}
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
