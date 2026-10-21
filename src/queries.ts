import { QueryClient, queryOptions } from "@tanstack/react-query";
import { readSettings } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import type { InboxEntry, NeedsYouItem, Overview } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import { writePageCache } from "./page-cache.ts";
import {
	readStoredPage,
	readStoredPolling,
	storedObject,
} from "./stored-page.ts";

/** A query stays fresh across a client navigation inside one poll interval. */
export const pageStaleTimeMs = 60_000;

export const pageQuery = {
	overview: queryOptions({
		queryKey: ["overview"],
		queryFn: () => fetchJson<Overview>("/api/overview"),
	}),
	needsYou: queryOptions({
		queryKey: ["needs-you"],
		queryFn: () => fetchJson<NeedsYouItem[]>("/api/needs-you"),
	}),
	inbox: queryOptions({
		queryKey: ["inbox"],
		queryFn: () => fetchJson<InboxEntry[]>("/api/inbox"),
	}),
	settings: queryOptions({
		queryKey: ["settings"],
		queryFn: readSettings,
	}),
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

export const pageQueryClient = client;

export async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`${path} failed (HTTP ${response.status})`);
	}
	return (await response.json()) as T;
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
	client.setQueryData(pageQuery.overview.queryKey, {
		...body,
		...(body.polling === true || polling === true ? { polling: true } : {}),
	});
	const settings = storedObject(embedded.settings);
	if (settings !== null) {
		client.setQueryData(pageQuery.settings.queryKey, settings as Configuration);
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
		client.setQueryData(pageQuery.needsYou.queryKey, stored as NeedsYouItem[]);
		return;
	}
	if (pathname === "/inbox" && Array.isArray(stored)) {
		client.setQueryData(pageQuery.inbox.queryKey, stored as InboxEntry[]);
	}
}

let eventsWired = false;

function applyOverviewEvent(body: Overview): void {
	client.setQueryData(pageQuery.overview.queryKey, body);
	writePageCache("polling", body.polling === true);
	void client.invalidateQueries(pageQuery.needsYou);
	void client.invalidateQueries(pageQuery.inbox);
}

function invalidatePageQueries(): void {
	void client.invalidateQueries(pageQuery.overview);
	void client.invalidateQueries(pageQuery.needsYou);
	void client.invalidateQueries(pageQuery.inbox);
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
		void client.invalidateQueries(pageQuery.inbox);
	});
}
