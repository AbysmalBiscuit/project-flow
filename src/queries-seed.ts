import type { SettingsRead } from "./client-settings.ts";
import type {
	InboxEntry,
	NeedsYouItem,
	Overview,
	ProjectReport,
} from "./domain.ts";
import { pageQueryClient } from "./queries-client.ts";
import { pageQuery } from "./queries-page.ts";
import { storedObject } from "./stored-page.ts";

let storedSeeded = false;

function pollUpdatedAt(value: unknown): number {
	if (typeof value !== "string") {
		return 0;
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function seedQueryData(
	queryKey: readonly unknown[],
	data: unknown,
	updatedAt: number,
): void {
	pageQueryClient.setQueryData(queryKey, data, { updatedAt });
}

function seedOverview(
	stored: Record<string, unknown>,
	polling: boolean | undefined,
): void {
	const overview = storedObject(stored.overview);
	if (overview === null) {
		return;
	}
	const body = overview as Overview;
	seedQueryData(
		pageQuery.overview.queryKey,
		{
			...body,
			...(body.polling === true || polling === true ? { polling: true } : {}),
		},
		pollUpdatedAt(body.fetchedAt),
	);
	const settings = storedObject(stored.settings);
	if (settings !== null) {
		pageQueryClient.setQueryData(
			pageQuery.settings.queryKey,
			settings as SettingsRead,
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
	if (polling === true) {
		const current = pageQueryClient.getQueryData(pageQuery.overview.queryKey);
		const updatedAt =
			pageQueryClient.getQueryState(pageQuery.overview.queryKey)
				?.dataUpdatedAt ?? 0;
		pageQueryClient.setQueryData(
			pageQuery.overview.queryKey,
			{
				...(current ?? { projects: [], fetchedAt: null, error: null }),
				polling: true,
			},
			{ updatedAt },
		);
	}
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
		return;
	}
	if (pathname === "/settings") {
		const body = storedObject(stored);
		if (body !== null) {
			pageQueryClient.setQueryData(
				pageQuery.settings.queryKey,
				body as SettingsRead,
			);
		}
		return;
	}
	seedStoredProject(pathname, stored);
}

function seedStoredProject(pathname: string, stored: unknown): void {
	if (!pathname.startsWith("/projects/")) {
		return;
	}
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
	pageQueryClient.setQueryData(
		pageQuery.project(name, "all").queryKey,
		report as ProjectReport,
		{ updatedAt: 0 },
	);
}
