import { useEffect, useRef } from "react";

import { isTextBox } from "./focus.ts";

/** A key press: `code` is `KeyboardEvent.code`, so Shift does not change the key. `ctrl` also matches Cmd. */
export type Combo = { code: string; ctrl?: true; shift?: true };

export type Shortcut = {
	group: string;
	label: string;
	/** The key press that runs the shortcut. */
	combo?: Combo;
	/** The keys and pointer actions to show, for a shortcut that is not a single key press. */
	keys?: readonly string[];
	/** The shortcut also runs while a text box has focus. */
	inTextBox?: true;
};

export const shortcuts = {
	showShortcuts: {
		group: "General",
		label: "View keyboard shortcuts",
		combo: { code: "Slash", ctrl: true },
	},
	openSearch: {
		group: "General",
		label: "Search tickets",
		combo: { code: "KeyK", ctrl: true },
		inTextBox: true,
	},
	closeOrClear: {
		group: "General",
		label: "Close a dialog or the side panel, or clear focus",
		keys: ["Esc"],
	},
	clearFocus: { group: "Focus", label: "Clear focus", keys: ["Ctrl", "Esc"] },
	toggleFocus: {
		group: "Focus",
		label: "Add or remove a ticket from focus",
		keys: ["Shift", "Click"],
	},
	focusDouble: {
		group: "Focus",
		label: "Add or remove a ticket from focus",
		keys: ["Double-click"],
	},
	selectArea: {
		group: "Graph",
		label: "Drag-select tickets into focus",
		keys: ["Shift", "Drag"],
	},
	openRun: {
		group: "Graph",
		label: "Open the latest run of a ticket",
		keys: ["Ctrl", "Click"],
	},
	copyTicketId: {
		group: "Copy",
		label: "Copy ticket id",
		combo: { code: "Period", ctrl: true },
	},
	copyTicketUrl: {
		group: "Copy",
		label: "Copy ticket URL",
		combo: { code: "KeyC", ctrl: true, shift: true },
	},
	copyPullId: {
		group: "Copy",
		label: "Copy PR id",
		combo: { code: "Comma", ctrl: true },
	},
	copyPullUrl: {
		group: "Copy",
		label: "Copy PR URL",
		combo: { code: "Comma", ctrl: true, shift: true },
	},
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof shortcuts;

const codeLabel: Record<string, string> = {
	Slash: "/",
	Period: ".",
	Comma: ",",
	Escape: "Esc",
};

function keyLabel(code: string): string {
	const label = codeLabel[code];
	if (label) return label;
	if (code.startsWith("Key")) return code.slice(3);
	return code;
}

/** The keys to show for a shortcut: its `keys` when set, otherwise the modifiers and key of its `combo`. */
export function shortcutKeys(shortcut: Shortcut): readonly string[] {
	if (shortcut.keys) return shortcut.keys;
	const combo = shortcut.combo;
	if (!combo) return [];
	const keys: string[] = [];
	if (combo.ctrl) keys.push("Ctrl");
	if (combo.shift) keys.push("Shift");
	keys.push(keyLabel(combo.code));
	return keys;
}

/** True when the key press runs the shortcut. Ctrl and Cmd both match a `ctrl` combo. */
export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
	const shortcut: Shortcut = shortcuts[id];
	const combo = shortcut.combo;
	if (!combo) return false;
	return (
		event.code === combo.code &&
		(event.ctrlKey || event.metaKey) === (combo.ctrl === true) &&
		event.shiftKey === (combo.shift === true) &&
		!event.altKey
	);
}

/** Runs `run` on the window key press of a shortcut while `enabled`. Skips text boxes unless the shortcut allows them. */
export function useShortcut(
	id: ShortcutId,
	run: () => void,
	enabled = true,
): void {
	const runRef = useRef(run);
	runRef.current = run;
	useEffect(() => {
		if (!enabled) return;
		const shortcut: Shortcut = shortcuts[id];
		const onKey = (event: KeyboardEvent) => {
			if (!matchesShortcut(event, id)) return;
			if (event.defaultPrevented) return;
			if (!shortcut.inTextBox && isTextBox(event.target)) return;
			event.preventDefault();
			runRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [id, enabled]);
}
