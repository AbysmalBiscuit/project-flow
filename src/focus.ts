import { useCallback, useEffect, useRef, useState } from "react";

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

const previewDelayMs = 250;

/**
 * The id under the pointer once it rests there for the preview delay.
 * A pointer that leaves before the delay shows no preview.
 */
export function useHoverPreview() {
	const [preview, setPreview] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const stop = useCallback(() => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
	}, []);
	const enter = useCallback(
		(id: string) => {
			stop();
			timer.current = setTimeout(() => {
				timer.current = null;
				setPreview(id);
			}, previewDelayMs);
		},
		[stop],
	);
	const leave = useCallback(() => {
		stop();
		setPreview(null);
	}, [stop]);
	useEffect(() => stop, [stop]);
	return { preview, enter, leave };
}

/** The seeds the view shows: the previewed id alone, else the focus set. */
export function shownSeeds(
	focus: ReadonlySet<string>,
	preview: string | null,
): ReadonlySet<string> {
	return preview === null ? focus : new Set([preview]);
}

/**
 * The focus set and the hover preview of one view. A change to the focus
 * set ends the preview, so the pointer must leave and enter again.
 */
export function useFocusView() {
	const set = useFocusSet();
	const hover = useHoverPreview();
	const { leave } = hover;
	useEffect(() => {
		void set.focus;
		leave();
	}, [set.focus, leave]);
	return { ...set, ...hover };
}

export type FocusView = ReturnType<typeof useFocusView>;
