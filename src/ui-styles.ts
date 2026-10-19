import * as stylex from "@stylexjs/stylex";
import {
	colours,
	font,
	measure,
	radius,
	scheme,
	space,
	type,
} from "./tokens.stylex.ts";

const focusRing = `${measure.focus} solid ${colours.focus}` as const;

export const root = stylex.create({
	canvas: {
		backgroundColor: colours.canvas,
		color: colours.ink,
		colorScheme: scheme.page,
	},
});

export const shell = stylex.create({
	page: {
		boxSizing: "border-box",
		maxWidth: measure.page,
		margin: "0 auto",
		padding: `${space.twoXl} ${space.lg} ${space.threeXl}`,
		color: colours.ink,
		fontFamily: font.sans,
		fontSize: type.body,
		lineHeight: type.line,
	},
	title: {
		margin: `0 0 ${space.sm}`,
		fontSize: type.title,
		fontWeight: type.weight,
		letterSpacing: type.track,
	},
	heading: {
		margin: `0 0 ${space.sm}`,
		fontSize: type.heading,
	},
	nav: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		margin: `0 0 ${space.lg}`,
	},
	link: {
		color: colours.link,
		textUnderlineOffset: space.twoXs,
	},
	linkFocus: {
		outline: {
			default: "none",
			":focus-visible": focusRing,
		},
		outlineOffset: space.twoXs,
	},
	button: {
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		padding: `${space.twoXs} ${space.md}`,
		backgroundColor: colours.surface,
		color: colours.ink,
		font: "inherit",
		cursor: "pointer",
	},
	buttonHover: {
		backgroundColor: {
			default: colours.surface,
			":hover": colours.surfaceMuted,
		},
	},
	buttonFocus: {
		outline: {
			default: "none",
			":focus-visible": focusRing,
		},
		outlineOffset: space.twoXs,
	},
	pressed: {
		backgroundColor: colours.accent,
		borderColor: colours.accent,
		color: colours.accentInk,
		fontWeight: type.weight,
	},
	stale: {
		margin: `0 0 ${space.md}`,
		padding: `${space.xs} ${space.sm}`,
		borderRadius: radius.sm,
		backgroundColor: colours.stale,
		color: colours.staleInk,
	},
	theme: {
		marginLeft: "auto",
	},
});

export const cards = stylex.create({
	list: {
		display: "grid",
		gridTemplateColumns: `repeat(auto-fill, minmax(${measure.card}, 1fr))`,
		gap: space.lg,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	card: {
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		borderRadius: radius.md,
		backgroundColor: colours.surface,
		boxShadow: `0 0 ${space.xl} ${colours.shadow}`,
	},
	projectLink: {
		color: {
			default: "inherit",
			":hover": colours.link,
		},
		textDecoration: "none",
	},
	counts: {
		display: "flex",
		flexWrap: "wrap",
		gap: `${space.xs} ${space.sm}`,
		margin: `${space.sm} 0 0`,
		color: colours.inkMuted,
		fontSize: type.small,
	},
	count: {
		display: "inline-flex",
		gap: space.twoXs,
		alignItems: "center",
	},
	swatch: {
		width: measure.swatch,
		height: measure.swatch,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
	},
	done: { backgroundColor: colours.done },
	dropped: { backgroundColor: colours.dropped },
	blocked: { backgroundColor: colours.blocked },
	backlog: { backgroundColor: colours.backlog },
	inProgress: { backgroundColor: colours.inProgress },
	inReview: { backgroundColor: colours.inReview },
	awaitingMerge: { backgroundColor: colours.awaitingMerge },
	tags: {
		margin: `${space.sm} 0 0`,
		color: colours.chipInk,
		fontSize: type.small,
	},
	blockers: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		margin: `${space.sm} 0 0`,
	},
	chip: {
		display: "inline-block",
		padding: `${space.twoXs} ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.pill,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontSize: type.small,
		textDecoration: "none",
	},
	chipHover: {
		outline: {
			default: "none",
			":hover": focusRing,
		},
	},
	graph: {
		overflow: "auto",
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		borderRadius: radius.md,
		backgroundColor: colours.surface,
	},
	mermaidHost: {
		maxWidth: measure.diagram,
	},
	pointer: {
		cursor: "pointer",
	},
	table: {
		width: "100%",
		borderCollapse: "collapse",
		backgroundColor: colours.surface,
	},
	cell: {
		padding: `${space.sm} ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		textAlign: "left",
	},
	head: {
		backgroundColor: colours.surfaceMuted,
		fontSize: type.small,
	},
	loading: {
		margin: `0 0 ${space.md}`,
		color: colours.inkMuted,
	},
});

export const project = stylex.create({
	section: {
		marginTop: space.xl,
		paddingTop: space.md,
		borderTopWidth: measure.hairline,
		borderTopStyle: "solid",
		borderTopColor: colours.line,
	},
	summary: {
		maxWidth: measure.page,
		margin: 0,
		fontSize: type.heading,
	},
	legend: {
		display: "flex",
		flexWrap: "wrap",
		gap: `${space.md} ${space.lg}`,
		margin: `0 0 ${space.md}`,
		padding: 0,
		listStyle: "none",
	},
	legendItem: {
		display: "flex",
		alignItems: "center",
		gap: space.xs,
		fontSize: type.small,
	},
	swatch: {
		width: measure.swatch,
		height: measure.swatch,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		display: "inline-block",
	},
	done: { backgroundColor: colours.done },
	dropped: { backgroundColor: colours.dropped },
	blocked: { backgroundColor: colours.blocked },
	backlog: { backgroundColor: colours.backlog },
	inProgress: { backgroundColor: colours.inProgress },
	inReview: { backgroundColor: colours.inReview },
	awaitingMerge: { backgroundColor: colours.awaitingMerge },
	theme: {
		backgroundColor: colours.theme,
		borderColor: colours.accent,
	},
	dashed: {
		backgroundColor: colours.dashed,
		borderStyle: "dashed",
	},
	tickets: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	ticket: {
		padding: `${space.xs} 0`,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	ticketOpen: {
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: "inherit",
		font: "inherit",
		textAlign: "left",
		cursor: "pointer",
	},
	ticketHover: {
		color: {
			default: "inherit",
			":hover": colours.link,
		},
	},
	highlighted: {
		outlineWidth: measure.focus,
		outlineStyle: "solid",
		outlineColor: colours.accent,
		outlineOffset: space.twoXs,
	},
	diagram: {
		margin: `${space.lg} 0`,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.line,
		borderRadius: radius.md,
		backgroundColor: colours.surface,
	},
	nodes: {
		margin: `${space.md} 0 0`,
		padding: 0,
		listStyle: "none",
	},
	dashedNode: {
		display: "inline-block",
		padding: `${space.twoXs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "dashed",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		color: colours.link,
	},
	reportNav: {
		display: "flex",
		flexWrap: "wrap",
		gap: `${space.md} ${space.lg}`,
		padding: `${space.sm} 0`,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	reportLink: {
		color: colours.link,
		textDecoration: {
			default: "none",
			":hover": "underline",
		},
	},
});

export const needs = stylex.create({
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		display: "flex",
		flexWrap: "wrap",
		gap: `${space.xs} ${space.sm}`,
		alignItems: "baseline",
		padding: `${space.md} 0`,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	answered: {
		color: colours.inkMuted,
	},
	headline: {
		fontWeight: type.weight,
	},
	open: {
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: "inherit",
		font: "inherit",
		textAlign: "left",
		cursor: "pointer",
	},
	openHover: {
		color: {
			default: "inherit",
			":hover": colours.link,
		},
	},
	tag: {
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontSize: type.small,
	},
	project: {
		color: colours.link,
	},
});

export const inbox = stylex.create({
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	entry: {
		display: "flex",
		flexWrap: "wrap",
		gap: `${space.xs} ${space.sm}`,
		alignItems: "baseline",
		padding: `${space.md} 0`,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	trigger: {
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontSize: type.small,
	},
	text: {
		color: colours.ink,
	},
});

export const panel = stylex.create({
	panel: {
		position: "fixed",
		top: 0,
		right: 0,
		width: measure.panel,
		maxWidth: "100%",
		height: "100%",
		overflow: "auto",
		padding: space.lg,
		borderLeftWidth: measure.hairline,
		borderLeftStyle: "solid",
		borderLeftColor: colours.line,
		backgroundColor: colours.surface,
		color: colours.ink,
		boxShadow: `0 0 ${space.xl} ${colours.shadow}`,
	},
	close: {
		marginBottom: space.md,
	},
	thread: {
		margin: 0,
		paddingLeft: space.lg,
	},
	comment: {
		marginBottom: space.md,
	},
	body: {
		margin: `0 0 ${space.xs}`,
		whiteSpace: "pre-wrap",
	},
	reply: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		marginTop: space.lg,
	},
	text: {
		minHeight: space.threeXl,
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		backgroundColor: colours.canvas,
		color: colours.ink,
		fontFamily: font.sans,
		fontSize: type.body,
	},
	error: {
		margin: 0,
		color: colours.danger,
	},
	tracker: {
		color: colours.link,
	},
});

export const settings = stylex.create({
	field: {
		display: "block",
		maxWidth: measure.form,
		margin: `${space.md} 0`,
	},
	control: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		marginTop: space.xs,
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		backgroundColor: colours.canvas,
		color: colours.ink,
		font: "inherit",
	},
	refs: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		maxWidth: measure.field,
		minHeight: measure.fieldMin,
		marginTop: space.xs,
		padding: space.sm,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
		backgroundColor: colours.canvas,
		color: colours.ink,
		font: "inherit",
	},
	note: {
		margin: `0 0 ${space.md}`,
		color: colours.inkMuted,
		fontSize: type.small,
	},
	choice: {
		display: "block",
		margin: `${space.xs} 0`,
	},
	error: {
		margin: `${space.md} 0 0`,
		color: colours.danger,
	},
	saved: {
		margin: `${space.md} 0 0`,
		color: colours.saved,
	},
});
