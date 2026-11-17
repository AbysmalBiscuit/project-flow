import * as stylex from "@stylexjs/stylex";

import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";

export const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
	},
	half: {
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		gap: space.xl,
		marginBottom: 0,
	},
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
	},
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
		marginLeft: "auto",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceStore: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	sourceNext: {
		marginLeft: 0,
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
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	pill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillOk: {
		backgroundColor: colours.okWash,
		color: colours.awaitingMerge,
	},
	pillInfo: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	pillWarn: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
	},
	scroll: {
		overflowX: "auto",
	},
	table: {
		width: "100%",
		borderCollapse: "collapse",
		fontVariantNumeric: "tabular-nums",
	},
	th: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		color: colours.inkSoft,
		fontSize: type.lane,
		fontWeight: type.weight,
		letterSpacing: type.headTrack,
		textAlign: "left",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	row: {
		backgroundColor: {
			default: null,
			":hover": colours.surface,
		},
	},
	rowOn: {
		backgroundColor: {
			default: colours.rowOn,
			":hover": colours.rowOn,
		},
	},
	td: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
		verticalAlign: "middle",
	},
	lastRow: {
		borderBottomWidth: 0,
	},
	number: {
		textAlign: "right",
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	barCell: {
		width: {
			default: "45%",
			[media.phone]: "30%",
		},
	},
	link: {
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colours.link,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: "inherit",
		textAlign: "left",
		textDecoration: "none",
	},
	bar: {
		display: "flex",
		height: measure.meterBar,
		overflow: "hidden",
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
	},
	fill: (share: string) => ({
		width: share,
		height: "100%",
		backgroundColor: colours.accent,
	}),
	fillLost: {
		backgroundColor: colours.warn,
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
	section: {
		marginTop: space.md,
	},
	note: {
		margin: `${space.sm} 0 0`,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	fixedRow: {
		height: measure.listRow,
	},
	expand: {
		padding: space.sm,
		backgroundColor: colours.page,
	},
	hits: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
	},
	hit: {
		display: "inline-flex",
		alignItems: "center",
		gap: space.xs,
		padding: `${space.xs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		color: colours.ink,
		fontSize: type.menu,
		cursor: "pointer",
	},
});
