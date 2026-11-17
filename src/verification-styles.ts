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
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
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
		marginBottom: 0,
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
	tileWarn: {
		color: colours.warn,
	},
	tileDetail: {
		color: colours.inkSoft,
		fontSize: type.meta,
		overflowWrap: "anywhere",
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
	mono: {
		fontFamily: font.mono,
	},
	sources: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		marginLeft: "auto",
	},
	source: {
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
	failure: {
		minWidth: measure.failureMin,
		maxWidth: measure.failureMax,
		overflow: "hidden",
		color: colours.inkSoft,
		fontSize: type.meter,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	strip: {
		display: "flex",
		gap: measure.stepGap,
	},
	cell: {
		flexShrink: 0,
		width: measure.stripCell,
		height: measure.stripCellHeight,
		borderRadius: radius.cell,
		backgroundColor: colours.awaitingMerge,
	},
	cellFailed: {
		backgroundColor: colours.danger,
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
	reason: {
		display: "block",
		color: colours.inkSoft,
		fontSize: type.meta,
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
	dot: {
		flexShrink: 0,
		alignSelf: "center",
		width: measure.resultDot,
		height: measure.resultDot,
		borderRadius: radius.pill,
		backgroundColor: colours.awaitingMerge,
	},
	dotBad: {
		backgroundColor: colours.danger,
	},
	tabs: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginBottom: space.md,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
	},
	tab: {
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderBottomWidth: measure.underline,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: "transparent",
		color: colours.inkMuted,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: type.menu,
	},
	tabOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
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
	picker: {
		maxWidth: measure.panel,
		fontSize: type.small,
	},
});
