import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

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

/**
 * The per-browser collapse state of each parent ticket, keyed by its ticket
 * key. A parent ticket with no stored state takes its `startsCollapsed` value.
 * The Table and the project graph share it. The functions change only when
 * the stored state changes.
 */
export function useCollapse(): {
	collapsed: (key: string, startsCollapsed: boolean) => boolean;
	toggle: (key: string, startsCollapsed: boolean) => void;
	setAll: (keys: readonly string[], collapsed: boolean) => void;
} {
	const current = useSyncExternalStore(subscribe, () => stored);
	return useMemo(() => {
		const collapsed = (key: string, startsCollapsed: boolean) =>
			current[key.toLowerCase()] ?? startsCollapsed;
		return {
			collapsed,
			toggle: (key: string, startsCollapsed: boolean) =>
				write({
					...stored,
					[key.toLowerCase()]: !collapsed(key, startsCollapsed),
				}),
			setAll: (keys: readonly string[], shut: boolean) =>
				write({
					...stored,
					...Object.fromEntries(keys.map((key) => [key.toLowerCase(), shut])),
				}),
		};
	}, [current]);
}
