import * as stylex from "@stylexjs/stylex";
import {
	darkScheme,
	darkTheme,
	lightScheme,
	lightTheme,
} from "./tokens.stylex.ts";
import { root } from "./ui-styles.ts";

export type PageTheme = "light" | "dark";

export function pageTheme(): PageTheme {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const lightClass =
	stylex.props(lightTheme, lightScheme, root.canvas).className ?? "";
const darkClass =
	stylex.props(darkTheme, darkScheme, root.canvas).className ?? "";

function classTokens(value: string): string[] {
	return value.split(" ").filter((token) => token !== "");
}

function paintVariables(theme: PageTheme): void {
	const blocks = (
		window as Window & {
			__projectFlowTheme?: { light: string; dark: string };
		}
	).__projectFlowTheme;
	const style = document.getElementById("project-flow-theme");
	const block = blocks?.[theme];
	if (style === null || block === undefined) {
		return;
	}
	style.textContent = block;
}

export function applyPageTheme(theme: PageTheme): void {
	const element = document.documentElement;
	element.dataset.theme = theme;
	element.style.colorScheme = theme;
	element.style.backgroundColor = "";
	element.style.color = "";
	paintVariables(theme);
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
