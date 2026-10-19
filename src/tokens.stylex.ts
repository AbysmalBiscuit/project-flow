import * as stylex from "@stylexjs/stylex";

const dark = "@media (prefers-color-scheme: dark)";

export const lightValues = {
	canvas: "#f4f1ea",
	surface: "#fffdf8",
	surfaceMuted: "#efeae0",
	ink: "#1c1915",
	inkMuted: "#5c564c",
	line: "#d9d1c3",
	lineStrong: "#8a8174",
	accent: "#1a5fb4",
	accentInk: "#f7fbff",
	link: "#1a4f96",
	chip: "#f3e2c4",
	chipInk: "#8a4b08",
	stale: "#f6e3a1",
	staleInk: "#5c4308",
	danger: "#9b1c1c",
	saved: "#1a5f3a",
	focus: "#1a5fb4",
	shadow: "#1c191526",
	done: "#8fbc8f",
	dropped: "#9ca3af",
	blocked: "#e6a0a0",
	backlog: "#d0d7de",
	inProgress: "#f0c674",
	inReview: "#9ecbff",
	awaitingMerge: "#b7e1cd",
	theme: "#e8eef7",
	dashed: "#fffdf8",
};

export const darkValues = {
	canvas: "#161411",
	surface: "#221e19",
	surfaceMuted: "#2c271f",
	ink: "#f3eee6",
	inkMuted: "#b7aea0",
	line: "#3d362c",
	lineStrong: "#8d8274",
	accent: "#7eb6ff",
	accentInk: "#101820",
	link: "#9cc7ff",
	chip: "#3d2a14",
	chipInk: "#f0c674",
	stale: "#4a3b16",
	staleInk: "#f6e3a1",
	danger: "#ffb4b4",
	saved: "#8fbc8f",
	focus: "#7eb6ff",
	shadow: "#00000080",
	done: "#3d6b45",
	dropped: "#5c636a",
	blocked: "#8a4545",
	backlog: "#3d444c",
	inProgress: "#8a6420",
	inReview: "#2f5578",
	awaitingMerge: "#2f5c48",
	theme: "#243044",
	dashed: "#221e19",
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
	done: { default: lightValues.done, [dark]: darkValues.done },
	dropped: { default: lightValues.dropped, [dark]: darkValues.dropped },
	blocked: { default: lightValues.blocked, [dark]: darkValues.blocked },
	backlog: { default: lightValues.backlog, [dark]: darkValues.backlog },
	inProgress: {
		default: lightValues.inProgress,
		[dark]: darkValues.inProgress,
	},
	inReview: { default: lightValues.inReview, [dark]: darkValues.inReview },
	awaitingMerge: {
		default: lightValues.awaitingMerge,
		[dark]: darkValues.awaitingMerge,
	},
	theme: { default: lightValues.theme, [dark]: darkValues.theme },
	dashed: { default: lightValues.dashed, [dark]: darkValues.dashed },
});

export const space = stylex.defineVars({
	twoXs: "0.15rem",
	xs: "0.35rem",
	sm: "0.5rem",
	md: "0.75rem",
	lg: "1rem",
	xl: "1.5rem",
	twoXl: "2rem",
	threeXl: "2.5rem",
});

export const radius = stylex.defineVars({
	sm: "0.35rem",
	md: "0.6rem",
	pill: "999px",
});

export const font = stylex.defineVars({
	sans: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
	mono: '"IBM Plex Mono", "Source Code Pro", ui-monospace, monospace',
});

export const type = stylex.defineVars({
	body: "1rem",
	small: "0.85rem",
	title: "1.7rem",
	heading: "1.15rem",
	line: "1.45",
	weight: "600",
	track: "0.01em",
});

export const measure = stylex.defineVars({
	page: "64rem",
	panel: "24rem",
	card: "24rem",
	form: "32rem",
	field: "28rem",
	fieldMin: "4rem",
	diagram: "48rem",
	swatch: "0.9rem",
	hairline: "1px",
	focus: "2px",
});
