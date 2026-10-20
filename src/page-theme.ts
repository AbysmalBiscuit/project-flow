import type { Configuration } from "./configuration.ts";

const themes = {
	light: { canvas: "#ffffff", ink: "#171717" },
	dark: { canvas: "#000000", ink: "#ededed" },
} as const;

const canvasVariable = "--x2phdem";

function palette(css: string, theme: Configuration["theme"]): string | null {
	const value = theme === "dark" ? "#000" : "#fff";
	return css.match(new RegExp(`${canvasVariable}:${value}[^}]*`))?.[0] ?? null;
}

export async function paintPage(
	html: string,
	theme: Configuration["theme"],
	origin: string,
): Promise<string> {
	const open = `<html lang="en" data-theme="${theme}" style="color-scheme:${theme};background-color:${themes[theme].canvas};color:${themes[theme].ink}">`;
	const href = html.match(/href="(\/[^"]+\.css)"/)?.[1];
	const css =
		href === undefined
			? ""
			: await fetch(new URL(href, origin))
					.then((response) => (response.ok ? response.text() : ""))
					.catch(() => "");
	const colours = palette(css, theme);
	const light = palette(css, "light");
	const dark = palette(css, "dark");
	const override =
		colours === null || light === null || dark === null
			? ""
			: `<style id="project-flow-theme">@layer priority1{:root{${colours}}html{color-scheme:${theme}}}html[data-theme="light"]{background-color:${themes.light.canvas};color:${themes.light.ink}}html[data-theme="dark"]{background-color:${themes.dark.canvas};color:${themes.dark.ink}}</style><script>window.__projectFlowTheme=${JSON.stringify({ light, dark })}</script>`;
	return html
		.replace('<html lang="en">', open)
		.replace("</head>", `${override}</head>`);
}
