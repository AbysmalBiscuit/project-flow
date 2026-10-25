import {
	QueryClient,
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";

import { readSettings, type SettingsRead } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import type {
	InboxEntry,
	NeedsYouItem,
	Overview,
	PostedReply,
	ProjectReport,
	RunCheckpoint,
	SettingsProject,
	ShownFactoryRun,
	Thread,
	Tracker,
} from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import type { FactoryEntry, Steer } from "./factories.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import type { StateSource } from "./settings-write.ts";
import { storedObject } from "./stored-page.ts";

type SettingsPage = {
	settings: Configuration;
	projects: SettingsProject[];
	trackers: { github: boolean; linear: boolean };
	factoryTokenReports: FactoryTokenReport[];
	factoryEntries: FactoryEntry[];
	stateSources: StateSource[];
};

type ReplyBody = {
	tracker: Tracker;
	project: string;
	key: string;
	body?: string;
	option?: number;
	parentId?: string;
	kind?: "comment" | "review";
};

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
		placeholderData: (previous: SettingsRead | null | undefined) => previous,
	}),
	settingsPage: queryOptions({
		queryKey: ["settings"],
		queryFn: readSettings,
		select: settingsPageOf,
		placeholderData: (previous: SettingsRead | null | undefined) => previous,
	}),
	project: (name: string, view: "all") =>
		queryOptions({
			queryKey: ["project", name, view],
			queryFn: () => readProject(name, view),
		}),
	thread: (tracker: string, project: string, key: string) =>
		queryOptions({
			queryKey: ["thread", tracker, project, key],
			queryFn: () => readThread(tracker, project, key),
			placeholderData: (previous: ThreadRead | undefined) => previous,
		}),
	/** The key holds the run's status and stage, so a change in the factory feed reads the checkpoint again. */
	checkpoint: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) =>
		queryOptions({
			queryKey: ["checkpoint", run.id, run.statusKind, run.stage ?? null],
			queryFn: () => readCheckpoint(run.id),
			placeholderData: (previous: RunCheckpoint | null | undefined) => previous,
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

export function configurationOf(
	body: SettingsRead | null,
): Configuration | null {
	if (body === null) {
		return null;
	}
	const {
		trackers: _trackers,
		projects: _projects,
		factoryEntries: _factoryEntries,
		stateSources: _stateSources,
		error: _error,
		...configuration
	} = body;
	return configuration;
}

export function settingsPageOf(body: SettingsRead | null): SettingsPage {
	if (body === null) {
		throw new Error("settings failed");
	}
	return {
		trackers: body.trackers ?? { github: false, linear: false },
		projects: body.projects ?? [],
		factoryTokenReports: body.factoryTokenReports ?? [],
		factoryEntries: body.factoryEntries ?? [],
		stateSources: body.stateSources ?? [],
		settings: configurationOf(body) ?? body,
	};
}

async function readProject(
	name: string,
	view: "all",
): Promise<ProjectReport | null> {
	const response = await fetch(
		`/api/projects/${encodeURIComponent(name)}?view=${view}`,
	);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`project failed (HTTP ${response.status})`);
	}
	return (await response.json()) as ProjectReport;
}

type ThreadRead =
	| { status: "ready"; thread: Thread }
	| { status: "missing" }
	| { status: "failed" };

async function readThread(
	tracker: string,
	project: string,
	key: string,
): Promise<ThreadRead> {
	const path = `/api/threads/${tracker}/${encodeURIComponent(key)}?project=${encodeURIComponent(project)}`;
	const response = await fetch(path);
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			missing?: boolean;
		} | null;
		return body?.missing === true
			? { status: "missing" }
			: { status: "failed" };
	}
	return { status: "ready", thread: (await response.json()) as Thread };
}

async function readCheckpoint(runId: string): Promise<RunCheckpoint | null> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/checkpoint`,
	);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`checkpoint failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunCheckpoint;
}

type SettingsWrite = Configuration & {
	baselineTracked?: Configuration["tracked"];
};

type SettingsPatch = (current: Configuration) => SettingsWrite;

function writeSettingsCache(patch: SettingsPatch): void {
	const key = pageQuery.settings.queryKey;
	const cached = pageQueryClient.getQueryData(key);
	const current = cached === undefined ? null : configurationOf(cached);
	if (cached === undefined || cached === null || current === null) {
		return;
	}
	// The write keeps the fetch time, so a seeded cache still refetches.
	const updatedAt = pageQueryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
	pageQueryClient.setQueryData(
		key,
		{ ...cached, ...patch(current) },
		{ updatedAt },
	);
}

const saveSettingsKey = ["save-settings"];

// Optimistic patches whose saves have not settled, in click order.
const optimisticPatches = new Set<SettingsPatch>();

export function useSaveSettings({
	refetchProjects = true,
	optimistic = false,
} = {}) {
	const queries = useQueryClient();
	return useMutation({
		mutationKey: saveSettingsKey,
		// Each save sends the whole configuration, so saves run in click order.
		scope: { id: "save-settings" },
		onMutate: (patch) => {
			if (optimistic) {
				optimisticPatches.add(patch);
				writeSettingsCache(patch);
			}
		},
		// The patch reads the settings when its turn comes, so it keeps the
		// choices that earlier saves wrote to the cache.
		mutationFn: async (patch: SettingsPatch): Promise<SettingsPage> => {
			const loaded = await queries.ensureQueryData(pageQuery.settings);
			const next = patch(settingsPageOf(loaded).settings);
			const response = await fetch("/api/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(next),
			});
			const body = (await response.json().catch(() => null)) as
				(SettingsRead & { error?: string }) | null;
			if (!response.ok) {
				throw new Error(body?.error ?? `save failed (HTTP ${response.status})`);
			}
			if (body === null) {
				throw new Error("save failed");
			}
			return settingsPageOf(body);
		},
		onSuccess: (saved, patch) => {
			// The saved configuration is the new base, and queued optimistic
			// choices stay on top of it until their own saves land.
			let settings = saved.settings;
			for (const queued of optimisticPatches) {
				if (queued !== patch) {
					settings = { ...settings, ...queued(settings) };
				}
			}
			const written: SettingsRead = {
				...settings,
				trackers: saved.trackers,
				projects: saved.projects,
				factoryTokenReports: saved.factoryTokenReports,
			};
			queries.setQueryData(pageQuery.settings.queryKey, written);
			if (refetchProjects) {
				void queries.invalidateQueries({ queryKey: ["project"] });
			}
		},
		onSettled: (_saved, _error, patch) => {
			optimisticPatches.delete(patch);
		},
	});
}

export function usePostReply(tracker: string, project: string, key: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (body: ReplyBody): Promise<PostedReply> => {
			const response = await fetch("/api/replies", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Reply failed");
			}
			return (await response.json()) as PostedReply;
		},
		onSuccess: async () => {
			await queries.invalidateQueries(pageQuery.thread(tracker, project, key));
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

export function useAnswerQuestion(run: string, question: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (text: string): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/questions/${encodeURIComponent(question)}/answer`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text }),
				},
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Answer failed");
			}
		},
		onSuccess: () => {
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

export function useSteerRun(run: string) {
	return useMutation({
		mutationFn: async (steer: Steer): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/steer`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(steer),
				},
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Steer failed");
			}
		},
	});
}

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

let eventsWired = false;

function applyViewsEvent(body: Overview): void {
	const updatedAt =
		pageQueryClient.getQueryState(pageQuery.overview.queryKey)?.dataUpdatedAt ??
		0;
	pageQueryClient.setQueryData(pageQuery.overview.queryKey, body, {
		updatedAt,
	});
	// A pending save writes the saved settings when it lands.
	if (pageQueryClient.isMutating({ mutationKey: saveSettingsKey }) === 0) {
		void pageQueryClient.invalidateQueries(pageQuery.settings);
	}
}

function applyOverviewEvent(body: Overview): void {
	applyViewsEvent(body);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
	void pageQueryClient.invalidateQueries({ queryKey: ["project"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["thread"] });
}

function invalidatePageQueries(): void {
	void pageQueryClient.invalidateQueries(pageQuery.overview);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
	void pageQueryClient.invalidateQueries(pageQuery.settings);
	void pageQueryClient.invalidateQueries({ queryKey: ["project"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["thread"] });
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
	onAppEvent("views", (event) => {
		applyViewsEvent(JSON.parse(event.data) as Overview);
	});
	onAppEvent("notification", () => {
		void pageQueryClient.invalidateQueries(pageQuery.inbox);
	});
}
