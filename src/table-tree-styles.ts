import * as stylex from "@stylexjs/stylex";

import { colours, measure, radius, space } from "./tokens.stylex.ts";

export const tableTree = stylex.create({
	tree: {
		display: "flex",
		alignItems: "center",
	},
	indent: {
		paddingLeft: space.lg,
	},
	toggle: {
		flex: "0 0 auto",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: space.lg,
		height: space.lg,
		marginRight: space.xs,
		padding: 0,
		borderWidth: 0,
		borderRadius: radius.sm,
		color: colours.inkSoft,
		cursor: "pointer",
	},
	toggleSpace: {
		flex: "0 0 auto",
		width: space.lg,
		marginRight: space.xs,
	},
	toggleMark: {
		width: measure.sortMark,
		height: measure.sortMark,
		transform: "rotate(90deg)",
	},
	toggleShut: {
		transform: "none",
	},
});
