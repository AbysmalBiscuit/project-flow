import type { Configuration } from "./configuration.ts";
import { pollingPageId, storedPageId } from "./stored-page.ts";
import { pageThemeMeta } from "./stylex-plugin.ts";

export function jsonForHtml(body: unknown): string {
	return JSON.stringify(body)
		.replaceAll("&", "\\u0026")
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

export function paintPage(
	html: string,
	theme: Configuration["theme"],
	stored?: unknown,
	polling = false,
): string {
	const themeMeta = pageThemeMeta();
	const surface = (name: Configuration["theme"]) =>
		`background-color:${themeMeta.canvas[name]};color:${themeMeta.ink[name]}`;
	const open = `<html lang="en" data-theme="${theme}" style="color-scheme:${theme};${surface(theme)}">`;
	const surfaces = `html[data-theme="light"]{${surface("light")}}html[data-theme="dark"]{${surface("dark")}}`;
	const blocks = {
		light: `@layer priority1{:root{${themeMeta.light}}html{color-scheme:light}}${surfaces}`,
		dark: `@layer priority1{:root{${themeMeta.dark}}html{color-scheme:dark}}${surfaces}`,
	};
	const style = `<style id="project-flow-theme">${blocks[theme]}</style><script>window.__projectFlowTheme=${jsonForHtml(blocks)}</script>`;
	const embedded =
		stored === undefined
			? ""
			: `<script id="${storedPageId}" type="application/json">${jsonForHtml(stored)}</script><script id="${pollingPageId}" type="application/json">${polling ? "true" : "false"}</script>`;
	return html
		.replace('<html lang="en">', open)
		.replace("</head>", `${style}${embedded}</head>`);
}
