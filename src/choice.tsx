import * as stylex from "@stylexjs/stylex";
import type { ComponentPropsWithoutRef } from "react";

import { control } from "./control-styles.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	choice: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		width: "100%",
		minWidth: 0,
		paddingInline: space.sm,
		textAlign: "left",
		whiteSpace: "nowrap",
	},
	label: {
		minWidth: 0,
		overflow: "hidden",
		textOverflow: "ellipsis",
	},
	mark: {
		boxSizing: "border-box",
		width: measure.dot,
		height: measure.dot,
		flexShrink: 0,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.controlLine,
		borderRadius: radius.pill,
		backgroundColor: "transparent",
	},
	markOn: {
		borderColor: colours.done,
		backgroundColor: colours.done,
	},
	number: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		width: measure.icon,
		height: measure.icon,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.small,
	},
});

type ChoiceProps = Omit<
	ComponentPropsWithoutRef<"button">,
	"children" | "className" | "style" | "title" | "type" | "aria-pressed"
> & {
	label: string;
} & (
		| {
				/** A menu choice: a dot marks the picked one. */
				on: boolean;
				number?: never;
		  }
		| {
				/** A numbered answer: a badge shows its number. */
				number: number;
				on?: never;
		  }
	);

/** One pickable row in a menu or an answer list, at the shared control height. */
export function Choice({ label, on, number, ...native }: ChoiceProps) {
	return (
		<button
			{...native}
			type="button"
			aria-pressed={on}
			title={label}
			className={clsx(
				control.box,
				control.off,
				control.press,
				styles.choice,
				control.focus,
			)}
		>
			{number === undefined ? (
				<span
					className={clsx(styles.mark, on === true && styles.markOn)}
					aria-hidden="true"
				/>
			) : (
				<span className={clsx(styles.number)}>{number}</span>
			)}
			<span className={clsx(styles.label)}>{label}</span>
		</button>
	);
}
