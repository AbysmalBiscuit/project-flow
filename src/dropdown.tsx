import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "./ui.ts";
import { frame, shell } from "./ui-styles.ts";

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
}: {
	id: string;
	label: string;
	value: string;
	choices: readonly DropdownChoice[];
	onChange: (id: string) => void;
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
			if (!root.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
		};
	}, [open]);
	return (
		<div className={clsx(frame.menu)} ref={root}>
			<button
				type="button"
				id={id}
				className={clsx(frame.menuButton, shell.buttonFocus)}
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setOpen((next) => !next)}
			>
				{current?.label}
				<span className={clsx(frame.caret)} aria-hidden="true">
					▾
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
