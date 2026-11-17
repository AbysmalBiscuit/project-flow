import * as stylex from "@stylexjs/stylex";

import { colours, font, measure, media, space, type } from "./tokens.stylex.ts";

export const styles = stylex.create({
	repos: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	sectionKicker: {
		marginBottom: space.xs,
	},
	section: {
		marginTop: space.md,
	},
	pills: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginBottom: space.xs,
	},
	text: {
		display: "block",
		margin: 0,
		color: colours.ink,
		fontSize: type.menu,
		overflowWrap: "anywhere",
	},
	votes: {
		display: "block",
		marginTop: space.xs,
		color: colours.inkSoft,
		fontSize: type.small,
		fontVariantNumeric: "tabular-nums",
	},
	actions: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		margin: `${space.md} 0`,
	},
	voteButton: {
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
		opacity: {
			default: null,
			":disabled": 0.5,
		},
	},
	warn: {
		margin: `${space.sm} 0 0`,
		color: colours.danger,
		fontSize: type.small,
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		display: "flex",
		gap: space.sm,
		alignItems: "baseline",
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
	},
	itemBody: {
		minWidth: 0,
		overflowWrap: "anywhere",
	},
	where: {
		flexShrink: 0,
		maxWidth: "50%",
		marginLeft: "auto",
		paddingLeft: space.sm,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		overflowWrap: "anywhere",
		textAlign: "right",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});
