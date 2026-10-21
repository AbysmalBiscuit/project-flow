import { installStatusColours } from "./domain.ts";
import { mountJumpBox } from "./jump.tsx";
import { watchNotifications } from "./notify.tsx";
import { installPageLinks } from "./page-links.ts";
import { clearTicketOnPageChange } from "./selection.ts";
import { applyPageTheme, pageTheme } from "./theme.ts";
import "./global.css";

installStatusColours(() => {
	const painted = (
		globalThis as { __projectFlowColours?: Record<string, string> }
	).__projectFlowColours;
	return painted ?? {};
});

watchNotifications();
mountJumpBox();
installPageLinks();

applyPageTheme(pageTheme());

const pages = [
	{ path: "/needs-you", load: () => import("./needs-you.tsx") },
	{ path: "/inbox", load: () => import("./inbox.tsx") },
	{ path: "/settings", load: () => import("./settings.tsx") },
] as const;

function pageLoad(path: string): () => Promise<unknown> {
	const match = pages.find((item) => item.path === path);
	if (match !== undefined) {
		return match.load;
	}
	if (path.startsWith("/projects/")) {
		return () => import("./project.tsx");
	}
	return () => import("./cards.tsx");
}

let shown = 0;

async function showPage(): Promise<void> {
	const turn = ++shown;
	const path = window.location.pathname;
	await pageLoad(path)();
	if (turn === shown && window.location.pathname === path) {
		window.dispatchEvent(new Event("project-flow-page"));
	}
}

await showPage();

window.addEventListener("popstate", () => {
	clearTicketOnPageChange(window.location.href);
	void showPage();
});
