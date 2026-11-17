import * as stylex from "@stylexjs/stylex";

import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

export const styles = stylex.create({
	card: {
		boxSizing: "border-box",
		minWidth: 0,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	flash: {
		outline: `${measure.focus} solid ${colours.accent}`,
	},
	head: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	heading: {
		margin: 0,
		color: colours.ink,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	source: {
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceOwn: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	more: {
		margin: `calc(-1 * ${space.sm}) 0 ${space.lg}`,
	},
	moreButton: {
		borderWidth: 0,
		color: colours.link,
		font: "inherit",
		fontSize: type.small,
		cursor: "pointer",
	},
});
