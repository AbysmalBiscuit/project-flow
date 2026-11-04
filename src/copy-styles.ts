import * as stylex from "@stylexjs/stylex";

/** The bare button of a value that copies itself on a click. */
export const copy = stylex.create({
	text: {
		borderWidth: 0,
		fontFamily: "inherit",
		lineHeight: "inherit",
		textAlign: "left",
		cursor: "copy",
	},
});
