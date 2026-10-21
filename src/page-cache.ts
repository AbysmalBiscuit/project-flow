import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { Configuration } from "./configuration.ts";
import type {
	InboxEntry,
	NeedsYouItem,
	Overview,
	ProjectReport,
	SettingsProject,
} from "./domain.ts";
import { pollingPageId, storedPageId } from "./stored-page.ts";

type SettingsPage = {
	settings: Configuration;
	projects: SettingsProject[];
	trackers: { github: boolean; linear: boolean };
};

type PageCache = {
	overview: Overview;
	settings: Configuration;
	inbox: InboxEntry[];
	"needs-you": NeedsYouItem[];
	"fetched-at": string | null;
	polling: boolean;
	"settings-page": SettingsPage;
};

type CacheKey = keyof PageCache | `project:${string}`;

const entries = new Map<string, PageCache[keyof PageCache] | ProjectReport>();

export function readPageCache<K extends keyof PageCache>(
	key: K,
): PageCache[K] | undefined;
export function readPageCache(
	key: `project:${string}`,
): ProjectReport | undefined;
export function readPageCache(
	key: CacheKey,
): PageCache[keyof PageCache] | ProjectReport | undefined {
	return entries.get(key);
}

export function writePageCache<K extends keyof PageCache>(
	key: K,
	body: PageCache[K],
): void;
export function writePageCache(
	key: `project:${string}`,
	body: ProjectReport,
): void;
export function writePageCache(
	key: CacheKey,
	body: PageCache[keyof PageCache] | ProjectReport,
): void {
	entries.set(key, body);
}

export function readStoredPolling(): boolean | undefined {
	const node = document.getElementById(pollingPageId);
	if (node === null) {
		return undefined;
	}
	return node.textContent === "true";
}

export function readStoredPage(): unknown {
	const node = document.getElementById(storedPageId);
	if (node === null || node.textContent === null || node.textContent === "") {
		return undefined;
	}
	return JSON.parse(node.textContent) as unknown;
}

function storedObject(body: unknown): Record<string, unknown> | null {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	return body as Record<string, unknown>;
}

let storedSeeded = false;

export function seedStoredPage(pathname: string): void {
	if (storedSeeded) {
		return;
	}
	storedSeeded = true;
	const polling = readStoredPolling();
	if (polling !== undefined) {
		writePageCache("polling", polling);
	}
	const stored = readStoredPage();
	if (stored === undefined) {
		return;
	}
	if (pathname === "/") {
		const overview = storedObject(stored);
		if (overview === null) {
			return;
		}
		const projects = Array.isArray(overview.projects) ? overview.projects : [];
		const storedRead = projects.some((project) => {
			const row = storedObject(project);
			return row !== null && row.pending !== true;
		});
		if (!storedRead && overview.tracked !== false) {
			return;
		}
		writePageCache("overview", overview as Overview);
		writePageCache(
			"polling",
			overview.polling === true || readStoredPolling() === true,
		);
		const fetchedAt =
			typeof overview.fetchedAt === "string" ? overview.fetchedAt : null;
		writePageCache("fetched-at", fetchedAt);
		return;
	}
	if (pathname === "/needs-you" && Array.isArray(stored)) {
		writePageCache("needs-you", stored as NeedsYouItem[]);
		return;
	}
	if (pathname === "/inbox" && Array.isArray(stored)) {
		writePageCache("inbox", stored as InboxEntry[]);
		return;
	}
	if (pathname === "/settings") {
		const body = storedObject(stored);
		if (body === null) {
			return;
		}
		const trackers = storedObject(body.trackers);
		const projects = Array.isArray(body.projects) ? body.projects : [];
		const { trackers: _trackers, projects: _projects, ...settings } = body;
		writePageCache("settings-page", {
			settings: settings as Configuration,
			projects: projects as SettingsProject[],
			trackers: {
				github: trackers?.github === true,
				linear: trackers?.linear === true,
			},
		});
		writePageCache("settings", settings as Configuration);
		return;
	}
	const prefix = "/projects/";
	if (pathname.startsWith(prefix)) {
		const report = storedObject(stored);
		if (report === null || report.pending === true) {
			return;
		}
		const name = decodeURIComponent(pathname.slice(prefix.length));
		writePageCache(`project:${name}`, report as ProjectReport);
	}
}

let root: Root | null = null;

export function mountPage(render: (root: Root) => void): void {
	const host = document.getElementById("root");
	if (host === null) {
		return;
	}
	root ??= createRoot(host);
	render(root);
}
