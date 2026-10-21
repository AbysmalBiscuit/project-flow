import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { Configuration } from "./configuration.ts";
import type { ProjectReport, SettingsProject } from "./domain.ts";
import {
	readStoredPage,
	readStoredPolling,
	storedObject,
} from "./stored-page.ts";

type SettingsPage = {
	settings: Configuration;
	projects: SettingsProject[];
	trackers: { github: boolean; linear: boolean };
};

type PageCache = {
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

let storedSeeded = false;

function seedOverview(stored: unknown, polling: boolean | undefined): void {
	const embedded = storedObject(stored);
	if (embedded === null) {
		return;
	}
	const overview = storedObject(embedded.overview);
	if (overview === null) {
		return;
	}
	writePageCache("polling", overview.polling === true || polling === true);
}

function seedSettingsPage(stored: unknown): void {
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
}

function seedProject(pathname: string, stored: unknown): void {
	const report = storedObject(stored);
	if (report === null || report.pending === true) {
		return;
	}
	let name: string;
	try {
		name = decodeURIComponent(pathname.slice("/projects/".length));
	} catch {
		return;
	}
	writePageCache(`project:${name}`, report as ProjectReport);
}

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
		seedOverview(stored, polling);
		return;
	}
	if (pathname === "/settings") {
		seedSettingsPage(stored);
		return;
	}
	if (pathname.startsWith("/projects/")) {
		seedProject(pathname, stored);
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
