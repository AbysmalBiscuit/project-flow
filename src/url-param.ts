import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener("popstate", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("popstate", listener);
	};
}

function readParam(name: string): string | null {
	return new URLSearchParams(window.location.search).get(name);
}

/**
 * One query parameter of the page URL as state. A set pushes a history
 * entry, so Back and Forward step through the values. Null removes it.
 */
export function useUrlParam(
	name: string,
): [string | null, (value: string | null) => void] {
	const value = useSyncExternalStore(
		subscribe,
		() => readParam(name),
		() => null,
	);
	const set = useCallback(
		(next: string | null) => {
			if (next === readParam(name)) {
				return;
			}
			const url = new URL(window.location.href);
			if (next === null) {
				url.searchParams.delete(name);
			} else {
				url.searchParams.set(name, next);
			}
			window.history.pushState(null, "", url);
			for (const listener of listeners) {
				listener();
			}
		},
		[name],
	);
	return [value, set];
}
