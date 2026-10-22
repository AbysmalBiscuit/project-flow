import * as stylex from "@stylexjs/stylex";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

export const settingsBots = stylex.create({
	bots: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		alignItems: "center",
	},
	addBot: {
		padding: `${space.twoXs} ${space.md}`,
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
});
