import type { Configuration } from "./configuration.ts";
import { pageThemeMeta, tokenColour } from "./stylex-plugin.ts";

export function paintPage(html: string, theme: Configuration["theme"]): string {
	const themeMeta = pageThemeMeta();
	const surface = (name: Configuration["theme"]) =>
		`background-color:${themeMeta.canvas[name]};color:${themeMeta.ink[name]}`;
	const open = `<html lang="en" data-theme="${theme}" style="color-scheme:${theme};${surface(theme)}">`;
	const surfaces = `html[data-theme="light"]{${surface("light")}}html[data-theme="dark"]{${surface("dark")}}`;
	const blocks = {
		light: `@layer priority1{:root{${themeMeta.light}}html{color-scheme:light}}${surfaces}`,
		dark: `@layer priority1{:root{${themeMeta.dark}}html{color-scheme:dark}}${surfaces}`,
	};
	const colours = {
		backlog: tokenColour("backlog"),
		inProgress: tokenColour("inProgress"),
		inReview: tokenColour("inReview"),
		awaitingMerge: tokenColour("awaitingMerge"),
		done: tokenColour("done"),
		dropped: tokenColour("dropped"),
	};
	const style = `<style id="project-flow-theme">${blocks[theme]}</style><script>window.__projectFlowTheme=${JSON.stringify(blocks)};window.__projectFlowColours=${JSON.stringify(colours)}</script>`;
	return html
		.replace('<html lang="en">', open)
		.replace("</head>", `${style}</head>`);
}
