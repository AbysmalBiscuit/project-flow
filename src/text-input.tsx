import * as stylex from "@stylexjs/stylex";
import { Search } from "lucide-react";
import type { ComponentPropsWithRef } from "react";

import { control } from "./control-styles.ts";
import { colours, measure, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const focusRing = `${measure.focus} solid ${colours.focus}` as const;

const styles = stylex.create({
	input: {
		minWidth: 0,
		cursor: "text",
		outline: {
			default: "none",
			":focus-visible": focusRing,
		},
		outlineOffset: space.twoXs,
		"::-webkit-search-decoration": {
			appearance: "none",
		},
		"::-webkit-search-cancel-button": {
			appearance: "none",
		},
	},
	frame: {
		display: "inline-flex",
		gap: space.sm,
		alignItems: "center",
		minWidth: 0,
		color: colours.inkSoft,
		cursor: "text",
		outline: {
			default: "none",
			":focus-within": focusRing,
		},
		outlineOffset: space.twoXs,
	},
	bare: {
		flexGrow: 1,
		minWidth: 0,
		height: "100%",
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colours.controlInk,
		fontFamily: "inherit",
		fontSize: "inherit",
		outline: "none",
		"::-webkit-search-decoration": {
			appearance: "none",
		},
		"::-webkit-search-cancel-button": {
			appearance: "none",
		},
	},
	invalid: {
		borderColor: colours.danger,
	},
	glyph: {
		flexShrink: 0,
		width: measure.glyph,
		height: measure.glyph,
	},
});

type TextInputProps = Omit<
	ComponentPropsWithRef<"input">,
	"className" | "style" | "type" | "size" | "width"
> & {
	type?: "text" | "search" | "number";
	/** A search glyph inside the field, before the text. */
	icon?: "search";
	/** Marks the value as not valid and draws a danger border. */
	invalid?: boolean;
	/** The width of the field in its row. */
	width?: stylex.StyleXStyles<{
		width?: string;
		flex?: string;
		flexGrow?: number;
		flexBasis?: string;
		maxWidth?: string;
	}>;
};

/** A text field at the shared control height. */
export function TextInput({
	type = "text",
	icon,
	invalid = false,
	width,
	...native
}: TextInputProps) {
	if (icon === undefined) {
		return (
			<input
				{...native}
				type={type}
				aria-invalid={invalid || undefined}
				className={clsx(
					control.box,
					styles.input,
					invalid && styles.invalid,
					width,
				)}
			/>
		);
	}
	return (
		<label
			className={clsx(
				control.box,
				styles.frame,
				invalid && styles.invalid,
				width,
			)}
			htmlFor={native.id}
		>
			<Search className={clsx(styles.glyph)} aria-hidden="true" />
			<input
				{...native}
				type={type}
				aria-invalid={invalid || undefined}
				className={clsx(styles.bare)}
			/>
		</label>
	);
}
