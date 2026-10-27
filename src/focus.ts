import { useCallback, useEffect, useRef, useState } from "react";

export type ClickKeys = {
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
};

/** The actions of a click on a card. A card without a run omits `openRun`. */
export type CardClick = {
	focus: () => void;
	open: () => void;
	openRun?: (() => void) | undefined;
};

/**
 * The action of a click with a modifier key: Shift-click toggles focus, and
 * Ctrl-click or Cmd-click opens the run page. Undefined means a plain click.
 */
function modifiedClick(
	event: ClickKeys,
	click: CardClick,
): (() => void) | undefined {
	if (event.shiftKey) {
		return click.focus;
	}
	if (event.ctrlKey || event.metaKey) {
		return click.openRun;
	}
	return undefined;
}

export function clickCard(event: ClickKeys, click: CardClick): void {
	(modifiedClick(event, click) ?? click.open)();
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
			if (event.ctrlKey || event.metaKey || !escapeTaken(event)) {
				event.preventDefault();
				clear();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [focused, clear]);
	return { focus, toggle, clear };
}

/**
 * True while an open menu or dialog takes Escape for itself. A menu button
 * names its popup with `aria-controls`; an expanded tree toggle names none
 * and leaves Escape to the view. A context menu has no button.
 */
export function menuOwnsEscape(): boolean {
	return (
		document.querySelector(
			"[aria-expanded='true'][aria-controls], [role='dialog'], [role='menu']",
		) !== null
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

const doubleClickMs = 300;

/**
 * Click handlers where a double click cancels the open of its first click.
 * A plain click opens only after the double-click wait.
 */
export function useClickOrDouble() {
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancel = useCallback(() => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
	}, []);
	const click = useCallback(
		(event: ClickKeys & { detail: number }, click: CardClick) => {
			cancel();
			const modified = modifiedClick(event, click);
			if (modified !== undefined) {
				modified();
				return;
			}
			if (event.detail > 1) {
				return;
			}
			timer.current = setTimeout(() => {
				timer.current = null;
				click.open();
			}, doubleClickMs);
		},
		[cancel],
	);
	const double = useCallback(
		(focus: () => void) => {
			cancel();
			focus();
		},
		[cancel],
	);
	useEffect(() => cancel, [cancel]);
	return { click, double };
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
