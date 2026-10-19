import * as stylex from "@stylexjs/stylex";

const dark = "@media (prefers-color-scheme: dark)";

export const colours = stylex.defineVars({
	canvas: { default: "#f4f1ea", [dark]: "#161411" },
	surface: { default: "#fffdf8", [dark]: "#221e19" },
	surfaceMuted: { default: "#efeae0", [dark]: "#2c271f" },
	ink: { default: "#1c1915", [dark]: "#f3eee6" },
	inkMuted: { default: "#5c564c", [dark]: "#b7aea0" },
	line: { default: "#d9d1c3", [dark]: "#3d362c" },
	lineStrong: { default: "#8a8174", [dark]: "#8d8274" },
	accent: { default: "#1a5fb4", [dark]: "#7eb6ff" },
	accentInk: { default: "#f7fbff", [dark]: "#101820" },
	link: { default: "#1a4f96", [dark]: "#9cc7ff" },
	chip: { default: "#f3e2c4", [dark]: "#3d2a14" },
	chipInk: { default: "#8a4b08", [dark]: "#f0c674" },
	stale: { default: "#f6e3a1", [dark]: "#4a3b16" },
	staleInk: { default: "#5c4308", [dark]: "#f6e3a1" },
	danger: { default: "#9b1c1c", [dark]: "#ffb4b4" },
	saved: { default: "#1a5f3a", [dark]: "#8fbc8f" },
	focus: { default: "#1a5fb4", [dark]: "#7eb6ff" },
	shadow: { default: "#1c191526", [dark]: "#00000080" },
	done: { default: "#8fbc8f", [dark]: "#3d6b45" },
	dropped: { default: "#9ca3af", [dark]: "#5c636a" },
	blocked: { default: "#e6a0a0", [dark]: "#8a4545" },
	backlog: { default: "#d0d7de", [dark]: "#3d444c" },
	inProgress: { default: "#f0c674", [dark]: "#8a6420" },
	inReview: { default: "#9ecbff", [dark]: "#2f5578" },
	awaitingMerge: { default: "#b7e1cd", [dark]: "#2f5c48" },
	theme: { default: "#e8eef7", [dark]: "#243044" },
	dashed: { default: "#fffdf8", [dark]: "#221e19" },
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
