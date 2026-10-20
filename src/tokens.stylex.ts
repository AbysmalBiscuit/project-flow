import * as stylex from "@stylexjs/stylex";

const dark = "@media (prefers-color-scheme: dark)";

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
	done: "#8fbc8f",
	dropped: "#9ca3af",
	blocked: "#e6a0a0",
	backlog: "#d0d7de",
	inProgress: "#f0c674",
	inReview: "#9ecbff",
	awaitingMerge: "#b7e1cd",
	theme: "#e6f4ff",
	dashed: "#ffffff",
	scrollbar: "#a1a1a1",
	scrollbarTrack: "#f2f2f2",
};

export const darkValues = {
	canvas: "#000000",
	surface: "#111111",
	surfaceMuted: "#1a1a1a",
	ink: "#ededed",
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
	done: "#3d6b45",
	dropped: "#5c636a",
	blocked: "#8a4545",
	backlog: "#3d444c",
	inProgress: "#8a6420",
	inReview: "#2f5578",
	awaitingMerge: "#2f5c48",
	theme: "#0d2137",
	dashed: "#111111",
	scrollbar: "#4d4d4d",
	scrollbarTrack: "#1a1a1a",
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
	scrollbar: { default: lightValues.scrollbar, [dark]: darkValues.scrollbar },
	scrollbarTrack: {
		default: lightValues.scrollbarTrack,
		[dark]: darkValues.scrollbarTrack,
	},
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
	sans: '"Geist Sans", "Geist", ui-sans-serif, system-ui, sans-serif',
	mono: '"Geist Mono", ui-monospace, monospace',
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

export const scheme = stylex.defineVars({
	page: "light",
});

export const lightTheme = stylex.createTheme(colours, lightValues);

export const darkTheme = stylex.createTheme(colours, darkValues);

export const lightScheme = stylex.createTheme(scheme, { page: "light" });

export const darkScheme = stylex.createTheme(scheme, { page: "dark" });

export const measure = stylex.defineVars({
	page: "72rem",
	panel: "24rem",
	card: "24rem",
	form: "32rem",
	field: "28rem",
	fieldMin: "4rem",
	diagram: "48rem",
	swatch: "0.9rem",
	hairline: "1px",
	focus: "2px",
	shell: "3rem",
	icon: "1.25rem",
	glyph: "1rem",
	badge: "1.15rem",
	search: "12rem",
	lane: "16rem",
});

export const stack = stylex.defineVars({
	panel: 1,
	jump: 2,
});
