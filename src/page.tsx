import type { ReactNode } from "react";
import { mountJumpBox } from "./jump.tsx";
import { watchNotifications } from "./notify.tsx";
import { mountPage } from "./page-cache.ts";
import { installPageLinks } from "./page-links.ts";
import { PageQueryRoot } from "./page-query.tsx";
import { seedPageQueries, wirePageQueryEvents } from "./queries.ts";
import { readStoredPage, readStoredPolling } from "./stored-page.ts";
import { applyPageTheme, pageTheme } from "./theme.ts";
import "./global.css";

watchNotifications();
mountJumpBox();
installPageLinks();
wirePageQueryEvents();

applyPageTheme(pageTheme());
const storedPage = readStoredPage();
const storedPolling = readStoredPolling();
seedPageQueries(window.location.pathname, storedPage, storedPolling);

const pages = [
	{ path: "/needs-you", load: () => import("./needs-you.tsx") },
	{ path: "/inbox", load: () => import("./inbox.tsx") },
	{ path: "/settings", load: () => import("./settings.tsx") },
] as const;

function pageLoad(path: string): () => Promise<{ Page: () => ReactNode }> {
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
let currentPage: (() => ReactNode) | null = null;

function paint(path: string): void {
	const Page = currentPage;
	if (Page === null) {
		return;
	}
	const key = path.startsWith("/projects/") ? path : undefined;
	mountPage((root) => {
		root.render(
			<PageQueryRoot>
				<Page {...(key === undefined ? {} : { key })} />
			</PageQueryRoot>,
		);
	});
}

async function showPage(): Promise<void> {
	const turn = ++shown;
	const path = window.location.pathname;
	const loaded = await pageLoad(path)();
	if (turn !== shown || window.location.pathname !== path) {
		return;
	}
	currentPage = loaded.Page;
	paint(path);
}

await showPage();

window.addEventListener("popstate", () => {
	void showPage();
});
