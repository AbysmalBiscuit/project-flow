import { useCallback, useEffect, useState } from "react";

export type FocusLink = { from: string; to: string };

/** The focused ids plus every id upstream or downstream of them through the links. */
export function focusChain(
	seeds: ReadonlySet<string>,
	links: readonly FocusLink[],
): ReadonlySet<string> {
	const chain = new Set(seeds);
	const walk = (next: (id: string) => string[]) => {
		const queue = [...seeds];
		const seen = new Set(seeds);
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			for (const other of next(id)) {
				if (!seen.has(other)) {
					seen.add(other);
					chain.add(other);
					queue.push(other);
				}
			}
		}
	};
	walk((id) => links.filter((link) => link.to === id).map((link) => link.from));
	walk((id) => links.filter((link) => link.from === id).map((link) => link.to));
	return chain;
}

export function isFocusClick(event: {
	ctrlKey: boolean;
	metaKey: boolean;
}): boolean {
	return event.ctrlKey || event.metaKey;
}

/**
 * The focus set of a view. Ctrl+Escape always clears it. A plain Escape
 * clears it only when no other handler, such as the side panel, took the key.
 */
export function useFocusSet() {
	const [focus, setFocus] = useState<ReadonlySet<string>>(() => new Set());
	const toggle = useCallback((id: string) => {
		setFocus((current) => {
			const next = new Set(current);
			if (!next.delete(id)) {
				next.add(id);
			}
			return next;
		});
	}, []);
	const clear = useCallback(() => setFocus(new Set()), []);
	const focused = focus.size > 0;
	useEffect(() => {
		if (!focused) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			if (isFocusClick(event) || !event.defaultPrevented) {
				event.preventDefault();
				clear();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [focused, clear]);
	return { focus, toggle, clear };
}
