import { watchNotifications } from "./notify.tsx";
import { applyPageTheme, type PageTheme, pageTheme } from "./theme.ts";
import "./tokens.css";

watchNotifications();

const themeKey = "project-flow-theme";

applyPageTheme(pageTheme());

document.addEventListener("click", (event) => {
	const target = event.target;
	if (!(target instanceof HTMLButtonElement)) {
		return;
	}
	if (target.dataset.themeToggle === undefined) {
		return;
	}
	const next: PageTheme =
		document.documentElement.dataset.theme === "dark" ? "light" : "dark";
	applyPageTheme(next);
	target.textContent = next === "dark" ? "Light mode" : "Dark mode";
	try {
		localStorage.setItem(themeKey, next);
	} catch {
		// A private window can throw. The chosen theme still shows this visit.
	}
});

if (window.location.pathname === "/needs-you") {
	await import("./needs-you.tsx");
} else if (window.location.pathname === "/inbox") {
	await import("./inbox.tsx");
} else if (window.location.pathname === "/settings") {
	await import("./settings.tsx");
} else if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
