import * as stylex from "@stylexjs/stylex";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import { board } from "./board-styles.ts";
import { control } from "./control-styles.ts";
import { space } from "./tokens.stylex.ts";
import { frame, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	choice: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
	},
});

export type DropdownChoice = {
	id: string;
	label: string;
};

/** Closes an open menu on a pointer down outside it or on Escape. */
export function useDismiss(
	root: RefObject<HTMLDivElement | null>,
	open: boolean,
	setOpen: (next: boolean) => void,
) {
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
	}, [root, open, setOpen]);
}

export function Caret() {
	return (
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
	);
}

export function Dropdown({
	id,
	label,
	value,
	choices,
	onChange,
	style,
	steadyWidth = false,
}: {
	id: string;
	label: string;
	value: string;
	choices: readonly DropdownChoice[];
	onChange: (id: string) => void;
	style?: stylex.StyleXStyles;
	/** Sizes the button to its widest choice, so a new value does not shift the layout. */
	steadyWidth?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const root = useRef<HTMLDivElement>(null);
	const current = choices.find((choice) => choice.id === value) ?? choices[0];
	useDismiss(root, open, setOpen);
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<button
				type="button"
				id={id}
				className={clsx(
					frame.menuButton,
					control.press,
					style,
					shell.buttonFocus,
				)}
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((next) => !next)}
			>
				{steadyWidth ? (
					<span className={clsx(frame.menuLabels)}>
						{choices.map((choice) => (
							<span
								key={choice.id}
								className={clsx(
									frame.menuLabel,
									choice !== current && frame.menuLabelOff,
								)}
								aria-hidden={choice !== current}
							>
								{choice.label}
							</span>
						))}
					</span>
				) : (
					current?.label
				)}
				<Caret />
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

/** A dropdown of checkboxes. No checked choice means every choice. */
export function MultiDropdown({
	id,
	label,
	allLabel,
	value,
	choices,
	onChange,
}: {
	id: string;
	label: string;
	allLabel: string;
	value: readonly string[];
	choices: readonly DropdownChoice[];
	onChange: (ids: string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const root = useRef<HTMLDivElement>(null);
	useDismiss(root, open, setOpen);
	const checked = choices.filter((choice) => value.includes(choice.id));
	const [first] = checked;
	const summary =
		first === undefined
			? allLabel
			: checked.length === 1
				? first.label
				: `${first.label} +${checked.length - 1}`;
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<button
				type="button"
				id={id}
				className={clsx(frame.menuButton, control.press, shell.buttonFocus)}
				aria-label={label}
				aria-haspopup="true"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((next) => !next)}
			>
				{summary}
				<Caret />
			</button>
			{open ? (
				<fieldset
					id={listId}
					className={clsx(frame.menuList)}
					aria-label={label}
				>
					<button
						type="button"
						className={clsx(frame.menuItem, shell.buttonFocus)}
						aria-pressed={checked.length === 0}
						onClick={() => onChange([])}
					>
						{allLabel}
					</button>
					{choices.map((choice) => (
						<label
							key={choice.id}
							className={clsx(frame.menuItem, styles.choice)}
						>
							<input
								type="checkbox"
								className={clsx(board.check)}
								checked={value.includes(choice.id)}
								onChange={(event) =>
									onChange(
										event.target.checked
											? [...value, choice.id]
											: value.filter((item) => item !== choice.id),
									)
								}
							/>
							{choice.label}
						</label>
					))}
				</fieldset>
			) : null}
		</div>
	);
}
