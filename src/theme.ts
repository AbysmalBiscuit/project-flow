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

export function applyPageTheme(theme: PageTheme): void {
	document.documentElement.dataset.theme = theme;
}

/** Dark when the page has applied dark, else the mermaid light theme. */
export function mermaidTheme(): "dark" | "default" {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

export function watchPageTheme(onChange: () => void): () => void {
	const onClick = (event: Event) => {
		const target = event.target;
		if (!(target instanceof HTMLButtonElement)) {
			return;
		}
		if (target.dataset.themeToggle === undefined) {
			return;
		}
		queueMicrotask(onChange);
	};
	document.addEventListener("click", onClick);
	return () => document.removeEventListener("click", onClick);
}
