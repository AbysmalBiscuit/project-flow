import { useSyncExternalStore } from "react";

export type OpenedTicket = {
	project: string;
	tracker: "github" | "linear";
	key: string;
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

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useActiveTicket(): OpenedTicket | null {
	return useSyncExternalStore(subscribe, activeTicket, activeTicket);
}
