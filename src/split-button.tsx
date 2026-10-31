import * as stylex from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";

import { control } from "./control-styles.ts";
import { Caret, useDismiss } from "./dropdown.tsx";
import { colours, measure, space } from "./tokens.stylex.ts";
import { frame } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	split: {
		display: "inline-flex",
	},
	part: {
		display: "inline-flex",
		alignItems: "center",
		whiteSpace: "nowrap",
	},
	main: {
		borderRightWidth: measure.none,
		borderTopRightRadius: measure.none,
		borderBottomRightRadius: measure.none,
	},
	more: {
		paddingInline: space.sm,
		borderTopLeftRadius: measure.none,
		borderBottomLeftRadius: measure.none,
	},
	// A filled tone hides its own border, so the caret needs a visible divider.
	divider: {
		borderLeftColor: colours.inkSoft,
	},
	start: {
		right: "auto",
		left: 0,
	},
	dangerChoice: {
		color: colours.danger,
	},
});

export type SplitChoice = {
	label: string;
	/** A danger choice stands out from the other ways to do the action, such as a cancel. */
	tone?: "danger";
	disabled?: boolean;
	/** The choice stays in reach while the main action is disabled, so its menu still opens. */
	independent?: boolean;
	onPick: () => void;
};

/**
 * A button for a large action with a menu of other ways to do it. The main part
 * runs the action, and the caret opens the menu. Without `onClick`, the main
 * part opens the menu too. The menu opens from the button's left edge, so the
 * button can sit at the left of a narrow panel.
 */
export function SplitButton({
	label,
	choicesLabel,
	choices,
	tone,
	disabled = false,
	onClick,
}: {
	label: string;
	/** The accessible name and tooltip of the caret. */
	choicesLabel: string;
	choices: readonly SplitChoice[];
	tone?: "primary" | "danger";
	disabled?: boolean;
	onClick?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const menuId = useId();
	const root = useRef<HTMLDivElement>(null);
	useDismiss(root, open, setOpen);
	const part = (
		side: typeof styles.main | typeof styles.more,
		divider = false,
	) =>
		clsx(
			control.box,
			control.off,
			control.press,
			styles.part,
			tone === "primary" && control.primary,
			tone === "danger" && control.danger,
			control.focus,
			side,
			divider && tone !== undefined && styles.divider,
		);
	return (
		<div className={clsx(frame.menu, styles.split)} ref={root}>
			<button
				type="button"
				className={part(styles.main)}
				disabled={disabled}
				onClick={onClick ?? (() => setOpen((next) => !next))}
			>
				{label}
			</button>
			<button
				type="button"
				className={part(styles.more, true)}
				aria-label={choicesLabel}
				title={choicesLabel}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={menuId}
				disabled={disabled && !choices.some((choice) => choice.independent)}
				onClick={() => setOpen((next) => !next)}
			>
				<Caret />
			</button>
			{open ? (
				<div
					id={menuId}
					className={clsx(frame.menuList, styles.start)}
					role="menu"
				>
					{choices.map((choice) => (
						<button
							key={choice.label}
							type="button"
							role="menuitem"
							className={clsx(
								frame.menuItem,
								control.clear,
								control.off,
								control.focus,
								choice.tone === "danger" && styles.dangerChoice,
							)}
							disabled={choice.disabled === true}
							onClick={() => {
								setOpen(false);
								choice.onPick();
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
