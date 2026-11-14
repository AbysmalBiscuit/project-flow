import Fuse from "fuse.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "./button.tsx";
import { jump } from "./jump-styles.ts";
import { shortcutsStyles } from "./shortcuts-styles.ts";
import { shortcutKeys, shortcuts, useShortcut } from "./shortcuts.ts";
import { TextInput } from "./text-input.tsx";
import { phoneGutter } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const entries = Object.entries(shortcuts).map(([id, shortcut]) => ({
	id,
	group: shortcut.group,
	label: shortcut.label,
	keys: shortcutKeys(shortcut),
}));

type Entry = (typeof entries)[number];

const fuse = new Fuse(entries, {
	keys: ["label", "group", "keys"],
	threshold: 0.4,
	ignoreLocation: true,
	useExtendedSearch: true,
});

function filterEntries(query: string): readonly Entry[] {
	const trimmed = query.trim();
	if (trimmed === "") {
		return entries;
	}
	return fuse.search(trimmed).map((hit) => hit.item);
}

function groupEntries(list: readonly Entry[]): [string, Entry[]][] {
	const groups = new Map<string, Entry[]>();
	for (const entry of list) {
		const members = groups.get(entry.group);
		if (members === undefined) {
			groups.set(entry.group, [entry]);
		} else {
			members.push(entry);
		}
	}
	return [...groups];
}

export function ShortcutsDialog() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const queryRef = useRef<HTMLInputElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const closeDialog = useCallback(() => {
		setOpen(false);
		const target = returnFocus.current;
		returnFocus.current = null;
		queueMicrotask(() => {
			if (target?.isConnected === true) {
				target.focus();
			}
		});
	}, []);
	useShortcut("showShortcuts", () => {
		if (open) {
			return;
		}
		const active = document.activeElement;
		returnFocus.current = active instanceof HTMLElement ? active : null;
		setQuery("");
		setOpen(true);
	});
	useEffect(() => {
		if (open) {
			queryRef.current?.focus();
		}
	}, [open]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			closeDialog();
		};
		window.addEventListener("keydown", onEscape, true);
		return () => window.removeEventListener("keydown", onEscape, true);
	}, [open, closeDialog]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || boxRef.current?.contains(target)) {
				return;
			}
			closeDialog();
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [open, closeDialog]);
	if (!open) {
		return null;
	}
	const visible = filterEntries(query);
	return (
		<div className={clsx(jump.shade, phoneGutter.shade)} id="shortcuts-shade">
			<div
				className={clsx(jump.box)}
				role="dialog"
				aria-label="Keyboard shortcuts"
				id="shortcuts-dialog"
				ref={boxRef}
			>
				<div className={clsx(shortcutsStyles.head)}>
					<h2 className={clsx(shortcutsStyles.title)}>Keyboard Shortcuts</h2>
					<Button icon="x" name="Close" onClick={closeDialog} />
				</div>
				<TextInput
					id="shortcuts-query"
					type="search"
					icon="search"
					aria-label="Search shortcuts"
					placeholder="Search shortcuts"
					value={query}
					ref={queryRef}
					onChange={(event) => setQuery(event.target.value)}
				/>
				{visible.length === 0 ? (
					<p className={clsx(jump.empty)}>No shortcuts</p>
				) : null}
				{groupEntries(visible).map(([group, members]) => (
					<section key={group}>
						<h3 className={clsx(shortcutsStyles.group)}>{group}</h3>
						<ul className={clsx(jump.list)}>
							{members.map((entry) => (
								<li
									key={entry.id}
									className={clsx(shortcutsStyles.row)}
									data-shortcut={entry.id}
								>
									<span>{entry.label}</span>
									<span className={clsx(shortcutsStyles.keys)}>
										{entry.keys.map((key) => (
											<kbd key={key} className={clsx(shortcutsStyles.key)}>
												{key}
											</kbd>
										))}
									</span>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</div>
	);
}

export function mountShortcutsDialog(): void {
	const host = document.createElement("div");
	host.style.display = "contents";
	document.body.append(host);
	createRoot(host).render(<ShortcutsDialog />);
}
