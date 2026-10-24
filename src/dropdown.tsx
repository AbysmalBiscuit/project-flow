import type * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";

import { frame, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

export type DropdownChoice = {
	id: string;
	label: string;
};

export function Dropdown({
	id,
	label,
	value,
	choices,
	onChange,
	style,
}: {
	id: string;
	label: string;
	value: string;
	choices: readonly DropdownChoice[];
	onChange: (id: string) => void;
	style?: stylex.StyleXStyles;
}) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const root = useRef<HTMLDivElement>(null);
	const current = choices.find((choice) => choice.id === value) ?? choices[0];
	useEffect(() => {
		if (!open) {
			return;
		}
		const close = (event: PointerEvent) => {
			const target = event.target;
			if (!root.current?.contains(target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			event.preventDefault();
			setOpen(false);
			root.current?.querySelector("button")?.focus();
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<button
				type="button"
				id={id}
				className={clsx(frame.menuButton, style, shell.buttonFocus)}
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((next) => !next)}
			>
				{current?.label}
				<span className={clsx(frame.caret)} aria-hidden="true">
					<svg
						viewBox="0 0 12 12"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M2.5 4.5 6 8l3.5-3.5" />
					</svg>
				</span>
			</button>
			{open ? (
				<div
					id={listId}
					className={clsx(frame.menuList)}
					role="listbox"
					aria-label={label}
				>
					{choices.map((choice, index) => (
						<button
							key={choice.id}
							type="button"
							id={`${id}-choice-${index}`}
							className={clsx(frame.menuItem, shell.buttonFocus)}
							role="option"
							aria-selected={choice.id === value}
							onClick={() => {
								onChange(choice.id);
								setOpen(false);
							}}
						>
							{choice.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
