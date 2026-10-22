import { useCallback, useEffect, useRef, useState } from "react";

/** A focus click toggles focus; any other click runs the view's open action. */
export function focusOrOpen(
	event: { ctrlKey: boolean; metaKey: boolean },
	focus: () => void,
	open: () => void,
): void {
	if (isFocusClick(event)) {
		focus();
		return;
	}
	open();
}

export function isFocusClick(event: {
	ctrlKey: boolean;
	metaKey: boolean;
}): boolean {
	return event.ctrlKey || event.metaKey;
}

/**
 * The focus set of a view. Ctrl+Escape always clears it. A plain Escape
 * clears it before the side panel sees the key, unless a menu or dialog is
 * open or the key lands in a text box.
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
			if (isFocusClick(event) || !escapeTaken(event)) {
				event.preventDefault();
				clear();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [focused, clear]);
	return { focus, toggle, clear };
}

/** True while an open menu or dialog takes Escape for itself. */
export function menuOwnsEscape(): boolean {
	return (
		document.querySelector("[aria-expanded='true'], [role='dialog']") !== null
	);
}

function escapeTaken(event: KeyboardEvent): boolean {
	return event.defaultPrevented || isTextBox(event.target) || menuOwnsEscape();
}

function isTextBox(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLTextAreaElement ||
		(target instanceof HTMLInputElement &&
			target.type !== "checkbox" &&
			target.type !== "radio")
	);
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
