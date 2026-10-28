import * as stylex from "@stylexjs/stylex";

import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

// A filled control keeps its colour, so hover and press shift its brightness.
const filledPress = {
	default: null,
	":hover": "brightness(1.12)",
	":active": "brightness(0.88)",
} as const;

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
	// Hover and press feedback for every clickable control.
	press: {
		backgroundColor: {
			default: colours.controlFill,
			":hover": colours.rowHover,
			":active": colours.controlPress,
		},
	},
	primary: {
		borderColor: colours.needs,
		backgroundColor: colours.needs,
		color: colours.needsInk,
		fontWeight: type.weight,
		filter: filledPress,
	},
	danger: {
		borderColor: colours.danger,
		backgroundColor: colours.danger,
		color: colours.accentInk,
		fontWeight: type.weight,
		filter: filledPress,
	},
});
