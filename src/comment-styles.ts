import * as stylex from "@stylexjs/stylex";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

export const commentBody = stylex.create({
	body: {
		minWidth: 0,
		maxWidth: "100%",
		margin: 0,
		overflowWrap: "anywhere",
		color: colours.ink,
		fontSize: type.card,
		lineHeight: type.line,
	},
	paragraph: {
		margin: 0,
		whiteSpace: "pre-line",
	},
	heading: {
		margin: `${space.sm} 0 ${space.xs}`,
		fontSize: type.heading,
		fontWeight: type.weight,
		lineHeight: type.line,
	},
	list: {
		margin: `${space.xs} 0`,
		paddingLeft: space.lg,
	},
	quote: {
		margin: `${space.xs} 0`,
		paddingLeft: space.sm,
		borderLeftWidth: measure.focus,
		borderLeftStyle: "solid",
		borderLeftColor: colours.lineStrong,
		color: colours.inkMuted,
	},
	code: {
		padding: `0 ${space.twoXs}`,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		fontFamily: font.mono,
		fontSize: type.meta,
	},
	pre: {
		maxWidth: "100%",
		margin: `${space.xs} 0`,
		overflowX: "auto",
		padding: space.sm,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		fontFamily: font.mono,
		fontSize: type.meta,
		whiteSpace: "pre",
	},
	table: {
		display: "block",
		maxWidth: "100%",
		margin: `${space.xs} 0`,
		overflowX: "auto",
		borderCollapse: "collapse",
		fontSize: type.meta,
	},
	cell: {
		padding: `${space.twoXs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		textAlign: "left",
		whiteSpace: "nowrap",
	},
	link: {
		color: colours.link,
	},
	check: {
		boxSizing: "border-box",
		width: measure.mark,
		height: measure.mark,
		margin: `0 ${space.twoXs} 0 0`,
		accentColor: colours.link,
		appearance: "auto",
		verticalAlign: "text-bottom",
	},
	checked: {
		marginRight: space.twoXs,
		color: colours.link,
		fontWeight: type.weight,
	},
});
