import { watchNotifications } from "./notify.tsx";

watchNotifications();

if (window.location.pathname === "/needs-you") {
	await import("./needs-you.tsx");
} else if (window.location.pathname === "/inbox") {
	await import("./inbox.tsx");
} else if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
