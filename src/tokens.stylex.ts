import * as stylex from "@stylexjs/stylex";

const dark = "@media (prefers-color-scheme: dark)";

export const media = stylex.defineConsts({
	phone: "@media (max-width: 64rem)",
	projectBar: "@media (max-width: 480px)",
	headerStack: "@media (max-width: 40rem)",
	// The one-line shell overflows below 32rem (512px).
	shellWrap: "@media (max-width: 32rem)",
});

export const lightValues = {
	canvas: "#ffffff",
	surface: "#fafafa",
	surfaceMuted: "#f2f2f2",
	ink: "#171717",
	inkMuted: "#4d4d4d",
	line: "#ebebeb",
	lineStrong: "#a1a1a1",
	accent: "#0070f3",
	accentInk: "#ffffff",
	link: "#0070f3",
	chip: "#e6f4ff",
	chipInk: "#0052b3",
	stale: "#fff4d6",
	staleInk: "#8a5a00",
	danger: "#e5484d",
	saved: "#007a4d",
	focus: "#0070f3",
	shadow: "#00000014",
	banner: "#fff4e5",
	bannerInk: "#9a3412",
	done: "#7c5cbf",
	dropped: "#9ca3af",
	theme: "#e6f4ff",
	dashed: "#ffffff",
	scrollbar: "#a1a1a1",
	scrollbarTrack: "#f2f2f2",
	page: "#fafaf9",
	raised: "#ffffff",
	inkSoft: "#71717a",
	laneLine: "#e7e7e4",
	backlog: "#8a8680",
	backlogWash: "#f4f3f1",
	inProgress: "#3b6fd8",
	inProgressWash: "#eef3fc",
	inReview: "#e07a2f",
	inReviewWash: "#fdf3ea",
	awaitingMerge: "#1f9d6a",
	awaitingMergeWash: "#e8f6ef",
	doneWash: "#f2eff9",
	droppedWash: "#f5f6f7",
	warn: "#b86e1a",
	warnWash: "#f8efe4",
	warnInk: "#8a5a12",
	needs: "#18181b",
	needsInk: "#ffffff",
	needsPill: "#ffffff",
	needsPillInk: "#18181b",
	segment: "#f3f3f1",
	controlLine: "#e7e7e4",
	controlInk: "#18181b",
	controlFill: "#ffffff",
	rowOn: "#eef2fd",
	groupFill: "#f7f7f6",
	groupLine: "#e2e2df",
	graphEdge: "#595959",
	graphEdgeDone: "#1f6f8a",
};

export const darkValues = {
	canvas: "#000000",
	surface: "#111111",
	surfaceMuted: "#1a1a1a",
	ink: "#ededef",
	inkMuted: "#a1a1a1",
	line: "#2e2e2e",
	lineStrong: "#4d4d4d",
	accent: "#3291ff",
	accentInk: "#000000",
	link: "#3291ff",
	chip: "#0d2137",
	chipInk: "#9cc7ff",
	stale: "#3d2e0a",
	staleInk: "#ffd16a",
	danger: "#ff6369",
	saved: "#3dd68c",
	focus: "#3291ff",
	shadow: "#00000080",
	banner: "#3d2a12",
	bannerInk: "#fdba74",
	done: "#b794f6",
	dropped: "#5c636a",
	theme: "#0d2137",
	dashed: "#111111",
	scrollbar: "#4d4d4d",
	scrollbarTrack: "#1a1a1a",
	page: "#0e0e10",
	raised: "#16161a",
	inkSoft: "#a1a1aa",
	laneLine: "#26262c",
	backlog: "#8a8680",
	backlogWash: "#222222",
	inProgress: "#5b8def",
	inProgressWash: "#1a2740",
	inReview: "#e08a45",
	inReviewWash: "#2c2118",
	awaitingMerge: "#3dbe86",
	awaitingMergeWash: "#162820",
	doneWash: "#262330",
	droppedWash: "#1d1e22",
	warn: "#e0a15a",
	warnWash: "#2a2218",
	warnInk: "#e8c49a",
	needs: "#ededef",
	needsInk: "#0e0e10",
	needsPill: "#ffffff",
	needsPillInk: "#18181b",
	segment: "#1d1d22",
	controlLine: "#26262c",
	controlInk: "#ededef",
	controlFill: "#16161a",
	rowOn: "#1a2236",
	groupFill: "#1c1c21",
	groupLine: "#3a3a42",
	graphEdge: "#c7c7c7",
	graphEdgeDone: "#7ec8e3",
};

export const colours = stylex.defineVars({
	canvas: { default: lightValues.canvas, [dark]: darkValues.canvas },
	surface: { default: lightValues.surface, [dark]: darkValues.surface },
	surfaceMuted: {
		default: lightValues.surfaceMuted,
		[dark]: darkValues.surfaceMuted,
	},
	ink: { default: lightValues.ink, [dark]: darkValues.ink },
	inkMuted: { default: lightValues.inkMuted, [dark]: darkValues.inkMuted },
	line: { default: lightValues.line, [dark]: darkValues.line },
	lineStrong: {
		default: lightValues.lineStrong,
		[dark]: darkValues.lineStrong,
	},
	accent: { default: lightValues.accent, [dark]: darkValues.accent },
	accentInk: { default: lightValues.accentInk, [dark]: darkValues.accentInk },
	link: { default: lightValues.link, [dark]: darkValues.link },
	chip: { default: lightValues.chip, [dark]: darkValues.chip },
	chipInk: { default: lightValues.chipInk, [dark]: darkValues.chipInk },
	stale: { default: lightValues.stale, [dark]: darkValues.stale },
	staleInk: { default: lightValues.staleInk, [dark]: darkValues.staleInk },
	danger: { default: lightValues.danger, [dark]: darkValues.danger },
	saved: { default: lightValues.saved, [dark]: darkValues.saved },
	focus: { default: lightValues.focus, [dark]: darkValues.focus },
	shadow: { default: lightValues.shadow, [dark]: darkValues.shadow },
	banner: { default: lightValues.banner, [dark]: darkValues.banner },
	bannerInk: { default: lightValues.bannerInk, [dark]: darkValues.bannerInk },
	done: { default: lightValues.done, [dark]: darkValues.done },
	dropped: { default: lightValues.dropped, [dark]: darkValues.dropped },
	theme: { default: lightValues.theme, [dark]: darkValues.theme },
	dashed: { default: lightValues.dashed, [dark]: darkValues.dashed },
	scrollbar: { default: lightValues.scrollbar, [dark]: darkValues.scrollbar },
	scrollbarTrack: {
		default: lightValues.scrollbarTrack,
		[dark]: darkValues.scrollbarTrack,
	},
	page: { default: lightValues.page, [dark]: darkValues.page },
	raised: { default: lightValues.raised, [dark]: darkValues.raised },
	inkSoft: { default: lightValues.inkSoft, [dark]: darkValues.inkSoft },
	laneLine: { default: lightValues.laneLine, [dark]: darkValues.laneLine },
	backlog: { default: lightValues.backlog, [dark]: darkValues.backlog },
	backlogWash: {
		default: lightValues.backlogWash,
		[dark]: darkValues.backlogWash,
	},
	inProgress: {
		default: lightValues.inProgress,
		[dark]: darkValues.inProgress,
	},
	inProgressWash: {
		default: lightValues.inProgressWash,
		[dark]: darkValues.inProgressWash,
	},
	inReview: { default: lightValues.inReview, [dark]: darkValues.inReview },
	inReviewWash: {
		default: lightValues.inReviewWash,
		[dark]: darkValues.inReviewWash,
	},
	awaitingMerge: {
		default: lightValues.awaitingMerge,
		[dark]: darkValues.awaitingMerge,
	},
	awaitingMergeWash: {
		default: lightValues.awaitingMergeWash,
		[dark]: darkValues.awaitingMergeWash,
	},
	doneWash: { default: lightValues.doneWash, [dark]: darkValues.doneWash },
	droppedWash: {
		default: lightValues.droppedWash,
		[dark]: darkValues.droppedWash,
	},
	warn: { default: lightValues.warn, [dark]: darkValues.warn },
	warnWash: { default: lightValues.warnWash, [dark]: darkValues.warnWash },
	warnInk: { default: lightValues.warnInk, [dark]: darkValues.warnInk },
	needs: { default: lightValues.needs, [dark]: darkValues.needs },
	needsInk: { default: lightValues.needsInk, [dark]: darkValues.needsInk },
	needsPill: {
		default: lightValues.needsPill,
		[dark]: darkValues.needsPill,
	},
	needsPillInk: {
		default: lightValues.needsPillInk,
		[dark]: darkValues.needsPillInk,
	},
	segment: { default: lightValues.segment, [dark]: darkValues.segment },
	controlLine: {
		default: lightValues.controlLine,
		[dark]: darkValues.controlLine,
	},
	controlInk: {
		default: lightValues.controlInk,
		[dark]: darkValues.controlInk,
	},
	controlFill: {
		default: lightValues.controlFill,
		[dark]: darkValues.controlFill,
	},
	rowOn: { default: lightValues.rowOn, [dark]: darkValues.rowOn },
	groupFill: { default: lightValues.groupFill, [dark]: darkValues.groupFill },
	groupLine: { default: lightValues.groupLine, [dark]: darkValues.groupLine },
	graphEdge: { default: lightValues.graphEdge, [dark]: darkValues.graphEdge },
	graphEdgeDone: {
		default: lightValues.graphEdgeDone,
		[dark]: darkValues.graphEdgeDone,
	},
});

/** The colours of one ticket state. `state-tone.ts` sets them per state. */
export const stateTone = stylex.defineVars({
	tone: colours.backlog,
	wash: colours.backlogWash,
});

export const space = stylex.defineVars({
	twoXs: "0.15rem",
	xs: "0.35rem",
	sm: "0.5rem",
	md: "0.75rem",
	lg: "1rem",
	xl: "1.5rem",
	pageInset: "5rem",
	// 16px at the browser default root size. The phone gutter cap.
	phoneInset: "1rem",
	navGap: "0.35rem",
	twoXl: "2rem",
	pageTop: "2.65rem",
	threeXl: "2.5rem",
});

export const radius = stylex.defineVars({
	sm: "0.35rem",
	md: "0.6rem",
	menu: "0.5rem",
	pill: "999px",
});

export const font = stylex.defineVars({
	sans: '"Geist Sans", "Geist", ui-sans-serif, system-ui, sans-serif',
	mono: '"Geist Mono", ui-monospace, monospace',
});

export const type = stylex.defineVars({
	body: "1rem",
	menu: "0.875rem",
	small: "0.85rem",
	title: "1.7rem",
	heading: "1.05rem",
	line: "1.45",
	weight: "600",
	regular: "400",
	track: "0.01em",
	lane: "0.72rem",
	card: "0.92rem",
	meta: "0.78rem",
	count: "0.88rem",
	kicker: "0.68rem",
	kickerTrack: "0.06em",
	nav: "0.875rem",
});

export const scheme = stylex.defineVars({
	page: "light",
});

export const lightTheme = stylex.createTheme(colours, lightValues);

export const darkTheme = stylex.createTheme(colours, darkValues);

export const lightScheme = stylex.createTheme(scheme, { page: "light" });

export const darkScheme = stylex.createTheme(scheme, { page: "dark" });

export const measure = stylex.defineVars({
	page: "84rem",
	panel: "24rem",
	card: "22rem",
	node: "12.25rem",
	form: "32rem",
	field: "28rem",
	fieldMin: "4rem",
	diagram: "48rem",
	swatch: "0.9rem",
	hairline: "1px",
	none: "0",
	focus: "2px",
	shell: "3.5rem",
	menu: "2.25rem",
	menuWide: "min(16rem, calc(100vw - 1rem))",
	menuTall: "min(22rem, calc(100dvh - 6rem))",
	filterPanel: "20rem",
	icon: "1.25rem",
	glyph: "1rem",
	badge: "1.35rem",
	search: "12rem",
	headerSearch: "9.5rem",
	lane: "16rem",
	boardMin: "36rem",
	dot: "0.45rem",
	searchBox: "14.5rem",
	reply: "5.5rem",
	panelTop: "4.5rem",
	spin: "1s",
	toggle: "2.25rem",
	mark: "1.15rem",
	tickShort: "0.32rem",
	tickTall: "0.58rem",
	sortMark: "0.7rem",
	needsRow: "3.125rem",
	bar: "4.5rem",
	contents: "11rem",
	narrow: "7rem",
	fact: "4.5rem",
	marker: "1.375rem",
	edgeDash: "0.35rem",
	edgeFlow: "0.8s",
	fade: "0.2s",
	move: "0.3s",
	switch: "2.1rem",
	headerControl: "2.25rem",
	button: "1.5rem",
	buttonIcon: "0.875rem",
	knob: "0.95rem",
	switchCol: "5.5rem",
	// Title, progress, legend and one chip row. Extra chips clip.
	overviewCard: "13.5rem",
	// The legend takes at most half the pane width.
	legendCap: `calc(50% - 2 * ${space.sm})`,
	tip: "16rem",
	// chipRow holds one type.small chip line with space.twoXs padding.
	chipRow: "1.7rem",
});

export const stack = stylex.defineVars({
	panel: 1,
	jump: 2,
	// Covers the stage while the page view stays mounted underneath.
	expanded: 3,
});

// Shared shell wrapping. Each caller picks its own breakpoint and row gap.
const shellWrap = {
	height: "auto",
	minHeight: measure.shell,
	flexWrap: "wrap",
	paddingTop: space.sm,
	paddingBottom: space.sm,
} as const;

export const projectHeaderLayout = stylex.create({
	head: {
		[media.headerStack]: {
			alignItems: "stretch",
		},
	},
	toolbar: {
		[media.headerStack]: {
			flexBasis: "100%",
			justifyContent: "flex-start",
		},
	},
});

export const projectBarLayout = stylex.create({
	// The project page adds this class.
	fit: {
		[media.projectBar]: shellWrap,
	},
});

export const phoneGutter = stylex.create({
	bar: {
		[media.phone]: {
			paddingLeft: space.phoneInset,
			paddingRight: space.phoneInset,
		},
		[media.shellWrap]: {
			...shellWrap,
			rowGap: space.sm,
		},
	},
	page: {
		[media.phone]: {
			paddingLeft: space.phoneInset,
			paddingRight: space.phoneInset,
		},
	},
	shade: {
		[media.phone]: {
			paddingLeft: space.phoneInset,
			paddingRight: space.phoneInset,
		},
	},
	cards: {
		[media.phone]: {
			gridTemplateColumns: "minmax(0, 1fr)",
		},
	},
});

export const phoneLayout = stylex.create({
	cardNeed: {
		[media.phone]: {
			gridTemplateColumns: "minmax(0, 1fr) auto",
		},
	},
	cardNeedKey: {
		[media.phone]: {
			gridColumn: "1 / -1",
		},
	},
	needsItem: {
		[media.phone]: {
			height: "auto",
			alignItems: "stretch",
			flexDirection: "column",
		},
	},
	needsAside: {
		[media.phone]: {
			marginLeft: 0,
			padding: `0 ${space.md} ${space.sm}`,
		},
	},
	needsRow: {
		[media.phone]: {
			height: "auto",
			padding: `${space.sm} ${space.md}`,
		},
	},
	needsKey: {
		[media.phone]: {
			flexBasis: "100%",
		},
	},
});
