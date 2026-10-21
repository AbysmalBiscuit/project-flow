import { QueryClient, queryOptions } from "@tanstack/react-query";
import { readSettings } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import type { InboxEntry, NeedsYouItem, Overview } from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import { writePageCache } from "./page-cache.ts";
import { storedObject } from "./stored-page.ts";

const pageStaleTimeMs = 60_000;

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

export const pageQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// 60 seconds keeps a query fresh across client navigation.
			staleTime: pageStaleTimeMs,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	},
});

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`${path} failed (HTTP ${response.status})`);
	}
	return (await response.json()) as T;
}

let storedSeeded = false;

function seedOverview(
	stored: Record<string, unknown>,
	polling: boolean | undefined,
): void {
	const overview = storedObject(stored.overview);
	if (overview === null) {
		return;
	}
	const body = overview as Overview;
	pageQueryClient.setQueryData(pageQuery.overview.queryKey, {
		...body,
		...(body.polling === true || polling === true ? { polling: true } : {}),
	});
	writePageCache("polling", body.polling === true || polling === true);
	const settings = storedObject(stored.settings);
	if (settings !== null) {
		pageQueryClient.setQueryData(
			pageQuery.settings.queryKey,
			settings as Configuration,
		);
	}
}

export function seedPageQueries(
	pathname: string,
	stored: unknown,
	polling: boolean | undefined,
): void {
	if (storedSeeded) {
		return;
	}
	storedSeeded = true;
	if (stored === undefined) {
		return;
	}
	if (pathname === "/") {
		const embedded = storedObject(stored);
		if (embedded !== null) {
			seedOverview(embedded, polling);
		}
		return;
	}
	if (pathname === "/needs-you" && Array.isArray(stored)) {
		pageQueryClient.setQueryData(
			pageQuery.needsYou.queryKey,
			stored as NeedsYouItem[],
		);
		return;
	}
	if (pathname === "/inbox" && Array.isArray(stored)) {
		pageQueryClient.setQueryData(
			pageQuery.inbox.queryKey,
			stored as InboxEntry[],
		);
	}
}

let eventsWired = false;

function applyOverviewEvent(body: Overview): void {
	pageQueryClient.setQueryData(pageQuery.overview.queryKey, body);
	writePageCache("polling", body.polling === true);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
}

function invalidatePageQueries(): void {
	void pageQueryClient.invalidateQueries(pageQuery.overview);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
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
		void pageQueryClient.invalidateQueries(pageQuery.inbox);
	});
}
