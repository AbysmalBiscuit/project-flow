import * as stylex from "@stylexjs/stylex";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

/**
 * The box that `Button`, `TextInput` and `Select` share, so controls in one
 * row line up.
 */
export const control = stylex.create({
	box: {
		boxSizing: "border-box",
		height: measure.control,
		margin: 0,
		padding: `0 ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.controlLine,
		borderRadius: radius.menu,
		backgroundColor: colours.controlFill,
		color: colours.controlInk,
		fontFamily: font.sans,
		fontSize: type.menu,
		fontWeight: type.regular,
		lineHeight: 1,
	},
	off: {
		opacity: {
			default: null,
			":disabled": 0.5,
		},
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
	},
});
