import * as stylex from "@stylexjs/stylex";

import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

export const shortcutsStyles = stylex.create({
	head: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
	},
	title: {
		margin: 0,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	group: {
		marginTop: space.md,
		marginBottom: 0,
		marginLeft: 0,
		marginRight: 0,
		fontSize: type.small,
		fontWeight: type.weight,
		color: colours.inkSoft,
	},
	row: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		gap: space.md,
		padding: `${space.sm} 0`,
		fontSize: type.menu,
	},
	keys: {
		display: "flex",
		gap: space.xs,
		flexShrink: 0,
	},
	key: {
		boxSizing: "border-box",
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		borderRadius: radius.sm,
		padding: `${space.xs} ${space.sm}`,
		fontFamily: font.mono,
		fontSize: type.small,
		lineHeight: 1,
		color: colours.inkSoft,
	},
});
