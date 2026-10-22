import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { TicketView } from "./domain.ts";

const storageKey = "project-flow.collapsed";

const storedShape = z.record(z.string(), z.boolean()).catch({});

type Stored = z.infer<typeof storedShape>;

function readStored(): Stored {
	try {
		const raw = window.localStorage.getItem(storageKey);
		return raw === null ? {} : storedShape.parse(JSON.parse(raw));
	} catch {
		return {};
	}
}

let stored = readStored();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function write(next: Stored): void {
	stored = next;
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(next));
	} catch {}
	for (const listener of listeners) {
		listener();
	}
}

function finished(ticket: TicketView): boolean {
	return ticket.statusType === "done" || ticket.statusType === "dropped";
}

/**
 * The per-browser collapse state of each parent ticket, keyed by its ticket
 * key. A parent ticket with no stored state starts collapsed when all its
 * sub-tickets are done.
 */
export function useCollapse(): {
	collapsed: (key: string, subTickets: readonly TicketView[]) => boolean;
	toggle: (key: string, subTickets: readonly TicketView[]) => void;
} {
	const current = useSyncExternalStore(subscribe, () => stored);
	const collapsed = (key: string, subTickets: readonly TicketView[]) =>
		current[key.toLowerCase()] ??
		(subTickets.length > 0 && subTickets.every(finished));
	return {
		collapsed,
		toggle: (key, subTickets) =>
			write({ ...stored, [key.toLowerCase()]: !collapsed(key, subTickets) }),
	};
}
