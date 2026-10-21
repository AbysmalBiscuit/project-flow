import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { Configuration } from "./configuration.ts";
import type { InboxEntry, NeedsYouItem, Overview } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import { pollingPageId, storedPageId } from "./stored-page.ts";

/** A query stays fresh across a client navigation inside one poll interval. */
export const pageStaleTimeMs = 60_000;

export const pageQuery = {
	overview: ["overview"] as const,
	needsYou: ["needs-you"] as const,
	inbox: ["inbox"] as const,
	settings: ["settings"] as const,
};

const client = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: pageStaleTimeMs,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	},
});

export function pageQueryClient(): QueryClient {
	return client;
}

export async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`${path} failed (HTTP ${response.status})`);
	}
	return (await response.json()) as T;
}

function readStoredPolling(): boolean | undefined {
	const node = document.getElementById(pollingPageId);
	if (node === null) {
		return undefined;
	}
	return node.textContent === "true";
}

function readStoredPage(): unknown {
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

function seed<T>(key: QueryKey, data: T): void {
	client.setQueryData(key, data, { updatedAt: Date.now() });
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
	const body = overview as Overview;
	seed(pageQuery.overview, {
		...body,
		...(body.polling === true || polling === true ? { polling: true } : {}),
	});
	const settings = storedObject(embedded.settings);
	if (settings !== null) {
		seed(pageQuery.settings, settings as Configuration);
	}
}

export function seedPageQueries(pathname: string): void {
	if (storedSeeded) {
		return;
	}
	storedSeeded = true;
	const polling = readStoredPolling();
	const stored = readStoredPage();
	if (stored === undefined) {
		return;
	}
	if (pathname === "/") {
		seedOverview(stored, polling);
		return;
	}
	if (pathname === "/needs-you" && Array.isArray(stored)) {
		seed(pageQuery.needsYou, stored as NeedsYouItem[]);
		return;
	}
	if (pathname === "/inbox" && Array.isArray(stored)) {
		seed(pageQuery.inbox, stored as InboxEntry[]);
	}
}

let eventsWired = false;

function applyOverviewEvent(body: Overview): void {
	client.setQueryData(pageQuery.overview, body);
	void client.invalidateQueries({ queryKey: pageQuery.needsYou });
	void client.invalidateQueries({ queryKey: pageQuery.inbox });
}

function invalidatePageQueries(): void {
	void client.invalidateQueries({ queryKey: pageQuery.overview });
	void client.invalidateQueries({ queryKey: pageQuery.needsYou });
	void client.invalidateQueries({ queryKey: pageQuery.inbox });
}

export function wirePageQueryEvents(): void {
	if (eventsWired || typeof window === "undefined") {
		return;
	}
	eventsWired = true;
	onEventStreamOpen(invalidatePageQueries);
	onAppEvent("overview", (event) => {
		applyOverviewEvent(JSON.parse(event.data) as Overview);
	});
	onAppEvent("notification", () => {
		void client.invalidateQueries({ queryKey: pageQuery.inbox });
	});
}
