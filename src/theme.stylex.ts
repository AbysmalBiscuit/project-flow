import * as stylex from "@stylexjs/stylex";
import { colours, scheme } from "./tokens.stylex.ts";

const lightValues = {
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

const darkValues = {
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

export const lightTheme = stylex.createTheme(colours, lightValues);

export const darkTheme = stylex.createTheme(colours, darkValues);

export const lightScheme = stylex.createTheme(scheme, { page: "light" });

export const darkScheme = stylex.createTheme(scheme, { page: "dark" });
