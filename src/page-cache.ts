import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import type { Configuration } from "./configuration.ts";
import type {
	InboxEntry,
	NeedsYouItem,
	Overview,
	PollProgress,
	ProjectReport,
	SettingsProject,
} from "./domain.ts";

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
	progress: PollProgress;
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

let root: Root | null = null;

export function mountPage(render: (root: Root) => void): void {
	const host = document.getElementById("root");
	if (host === null) {
		return;
	}
	root ??= createRoot(host);
	render(root);
}
