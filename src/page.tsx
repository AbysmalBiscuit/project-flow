import { watchNotifications } from "./notify.tsx";
import "./tokens.css";

watchNotifications();

const themeKey = "project-flow-theme";

function storedTheme(): "light" | "dark" {
	try {
		return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

function applyTheme(theme: "light" | "dark"): void {
	document.documentElement.dataset.theme = theme;
}

applyTheme(storedTheme());

document.addEventListener("click", (event) => {
	const target = event.target;
	if (!(target instanceof HTMLButtonElement)) {
		return;
	}
	if (target.dataset.themeToggle === undefined) {
		return;
	}
	const next =
		document.documentElement.dataset.theme === "dark" ? "light" : "dark";
	applyTheme(next);
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
} else if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
