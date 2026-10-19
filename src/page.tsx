import { watchNotifications } from "./notify.tsx";
import { applyPageTheme, pageTheme } from "./theme.ts";
import "./global.css";

watchNotifications();

applyPageTheme(pageTheme());

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
