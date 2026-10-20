import * as stylex from "@stylexjs/stylex";
import {
	darkScheme,
	darkTheme,
	lightScheme,
	lightTheme,
} from "./tokens.stylex.ts";
import { root } from "./ui-styles.ts";

export type PageTheme = "light" | "dark";

const themeKey = "project-flow-theme";

/** The theme the page applies: the toggle's stored choice, else light. */
export function pageTheme(): PageTheme {
	try {
		return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

const lightClass =
	stylex.props(lightTheme, lightScheme, root.canvas).className ?? "";
const darkClass =
	stylex.props(darkTheme, darkScheme, root.canvas).className ?? "";

function classTokens(value: string): string[] {
	return value.split(" ").filter((token) => token !== "");
}

export function applyPageTheme(theme: PageTheme): void {
	const element = document.documentElement;
	element.dataset.theme = theme;
	for (const token of classTokens(`${lightClass} ${darkClass}`)) {
		element.classList.remove(token);
	}
	const selected = theme === "dark" ? darkClass : lightClass;
	for (const token of classTokens(selected)) {
		element.classList.add(token);
	}
	element.dispatchEvent(
		new CustomEvent("project-flow-theme", { detail: theme }),
	);
}

/** Dark when the page has applied dark, else the mermaid light theme. */
export function mermaidTheme(): "dark" | "default" {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

export function watchPageTheme(
	onChange: (theme: PageTheme) => void,
): () => void {
	const element = document.documentElement;
	const onTheme = (event: Event) => {
		const theme = event instanceof CustomEvent ? event.detail : undefined;
		onChange(theme === "dark" ? "dark" : "light");
	};
	element.addEventListener("project-flow-theme", onTheme);
	return () => element.removeEventListener("project-flow-theme", onTheme);
}
