import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";

import { control } from "./control-styles.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	chip: {
		display: "inline-flex",
		gap: space.xs,
		alignItems: "center",
		padding: `${space.twoXs} ${space.twoXs} ${space.twoXs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.chipInk,
		borderRadius: radius.pill,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontFamily: font.sans,
		fontSize: type.meta,
		lineHeight: 1,
	},
	remove: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: measure.glyph,
		height: measure.glyph,
		padding: 0,
		borderWidth: 0,
		borderRadius: radius.pill,
		color: colours.chipInk,
		cursor: "pointer",
	},
	cross: {
		width: measure.buttonIcon,
		height: measure.buttonIcon,
	},
});

/** A value in a list the user edits, with a cross that removes it. */
export function Chip({
	label,
	removeLabel,
	onRemove,
}: {
	label: string;
	removeLabel: string;
	onRemove: () => void;
}) {
	return (
		<span className={clsx(styles.chip)}>
			{label}
			<button
				type="button"
				className={clsx(styles.remove, control.clear, control.focus)}
				aria-label={removeLabel}
				onClick={onRemove}
			>
				<X className={clsx(styles.cross)} aria-hidden="true" />
			</button>
		</span>
	);
}
