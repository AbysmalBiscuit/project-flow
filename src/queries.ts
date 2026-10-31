import {
	QueryClient,
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";

import { readSettings, type SettingsRead } from "./client-settings.ts";
import type { Configuration } from "./configuration.ts";
import {
	type BackendViews,
	type InboxEntry,
	liveRunStatusKinds,
	type NeedsYouItem,
	type Overview,
	type PostedReply,
	type ProjectReport,
	type RunAgent,
	type RunArtifact,
	type RunArtifactContent,
	type RunCheckpoint,
	type RunDetail,
	type RunFile,
	type RunSandbox,
	type RunSettings,
	type RunSource,
	type SettingsProject,
	type ShownFactoryRun,
	type Thread,
	type TrackerKind,
} from "./domain.ts";
import { onAppEvent, onEventStreamOpen } from "./events.ts";
import type { FactoryEntry } from "./factories.ts";
import type { ArtifactsRead } from "./factory-run-artifacts.ts";
import type { CheckpointRead } from "./factory-run-detail.ts";
import type { FilesRead } from "./factory-run-files.ts";
import type { SandboxRead } from "./factory-run-sandbox.ts";
import type { RunSettingsRead } from "./factory-run-settings.ts";
import type { SourceRead } from "./factory-run-source.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import type { RunListRow } from "./run-list.ts";
import type { StateSource } from "./settings-write.ts";
import { pendingStatus } from "./stale-reads.ts";
import { storedObject } from "./stored-page.ts";

type SettingsPage = {
	settings: Configuration;
	projects: SettingsProject[];
	backends: BackendViews;
	factoryTokenReports: FactoryTokenReport[];
	factoryEntries: FactoryEntry[];
	stateSources: StateSource[];
};

type ReplyBody = {
	tracker: TrackerKind;
	project: string;
	key: string;
	body?: string;
	option?: number;
	parentId?: string;
	kind?: "comment" | "review";
};

const pageStaleTimeMs = 60_000;

export const agentReadMs = 5_000;

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
	thread: (tracker: string, project: string, key: string) => {
		const queryKey = ["thread", tracker, project, key];
		return queryOptions({
			queryKey,
			queryFn: () => readThread(tracker, project, key, queryKey),
			placeholderData: (previous: ThreadRead | undefined) => previous,
		});
	},
	/** A change in the factory feed reads the Runs list again. */
	runs: queryOptions({
		queryKey: ["runs"],
		queryFn: () => fetchJson<RunListRow[]>("/api/factory-runs"),
		placeholderData: (previous: RunListRow[] | undefined) => previous,
	}),
	/** A change in the factory feed reads the run again. */
	run: (id: string) =>
		queryOptions({
			queryKey: ["run", id],
			queryFn: () => readRun(id),
			placeholderData: (previous: RunDetail | null | undefined) => previous,
		}),
	/** The key holds the run's status and stage, so a change in the factory feed reads the checkpoint again. */
	checkpoint: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["checkpoint", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readCheckpoint(run.id, queryKey),
			placeholderData: (previous: CheckpointRead | undefined) => previous,
		});
	},
	/** The key holds the run's status and stage, so a stage that ends reads the artifacts again. */
	artifacts: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["artifacts", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readArtifacts(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: ArtifactsRead | undefined) => previous,
		});
	},
	/** The key holds the run's status and stage, so a stage that ends reads the sandbox again. */
	sandbox: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["sandbox", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readSandbox(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: SandboxRead | undefined) => previous,
		});
	},
	/** The key holds the run's status and stage, so a stage that ends reads the changed files again. */
	files: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["files", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readFiles(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: FilesRead | undefined) => previous,
		});
	},
	/** The key holds the run's status, so a queued run reads its source again once it loads its package. */
	source: (run: Pick<ShownFactoryRun, "id" | "statusKind">) => {
		const queryKey = ["source", run.id, run.statusKind];
		return queryOptions({
			queryKey,
			queryFn: () => readSource(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: SourceRead | undefined) => previous,
		});
	},
	/** The key holds the run's status and stage, so a node that starts its worker reads its choice again. */
	runSettings: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["runSettings", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readRunSettings(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: RunSettingsRead | undefined) => previous,
		});
	},
	artifact: (runId: string, artifact: Pick<RunArtifact, "folder" | "name">) => {
		const queryKey = ["artifact", runId, artifact.folder, artifact.name];
		return queryOptions({
			queryKey,
			queryFn: () => readArtifact(runId, artifact, queryKey),
			...pendingRetry,
		});
	},
	/** A live run reads its agents again on an interval while a view follows it, and an ended run reads none. */
	agents: (run: Pick<ShownFactoryRun, "id" | "statusKind">) => {
		const live = liveRunStatusKinds.some((kind) => kind === run.statusKind);
		const queryKey = ["agents", run.id, run.statusKind];
		return queryOptions({
			queryKey,
			queryFn: () => readAgents(run.id, queryKey),
			enabled: live,
			refetchInterval: live ? agentReadMs : false,
		});
	},
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
		forges: _forges,
		switches: _switches,
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
		backends: {
			trackers: body.trackers ?? [],
			forges: body.forges ?? [],
			switches: body.switches ?? [],
		},
		projects: body.projects ?? [],
		factoryTokenReports: body.factoryTokenReports ?? [],
		factoryEntries: body.factoryEntries ?? [],
		stateSources: body.stateSources ?? [],
		settings: configurationOf(body) ?? body,
	};
}

/** The app has not answered the read yet: it answered 202 and reads in the background. */
export class PendingRead extends Error {}

/**
 * An overview event that comes while the first read of a query runs joins that
 * read, so the query can end pending after the app has its answer. The query
 * reads again until the app answers.
 */
export const pendingRetry = {
	retry: (failures: number, error: Error) =>
		error instanceof PendingRead && failures < 40,
	retryDelay: 250,
};

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

/** A read that the app has not answered yet keeps what the page holds. */
export function heldData<T>(queryKey: readonly unknown[]): T | undefined {
	return pageQueryClient.getQueryData<T>(queryKey);
}

type ThreadRead =
	| { status: "ready"; thread: Thread }
	| { status: "pending" }
	| { status: "missing" }
	| { status: "failed" };

async function readThread(
	tracker: string,
	project: string,
	key: string,
	queryKey: readonly unknown[],
): Promise<ThreadRead> {
	const path = `/api/threads/${tracker}/${encodeURIComponent(key)}?project=${encodeURIComponent(project)}`;
	const response = await fetch(path);
	if (response.status === pendingStatus) {
		return heldData<ThreadRead>(queryKey) ?? { status: "pending" };
	}
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

async function readAgents(
	runId: string,
	queryKey: readonly unknown[],
): Promise<RunAgent[]> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/agents`,
	);
	if (response.status === pendingStatus) {
		return heldData<RunAgent[]>(queryKey) ?? [];
	}
	if (response.status === 404) {
		return [];
	}
	if (!response.ok) {
		throw new Error(`agents failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { agents: RunAgent[] }).agents;
}

async function readRun(id: string): Promise<RunDetail | null> {
	const response = await fetch(`/api/factory-runs/${encodeURIComponent(id)}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`run failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunDetail;
}

async function readCheckpoint(
	runId: string,
	queryKey: readonly unknown[],
): Promise<CheckpointRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/checkpoint`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<CheckpointRead>(queryKey);
		if (held === undefined) {
			throw new Error("checkpoint pending");
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`checkpoint failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunCheckpoint;
}

async function readArtifacts(
	runId: string,
	queryKey: readonly unknown[],
): Promise<ArtifactsRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/artifacts`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<ArtifactsRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`artifacts failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { artifacts: RunArtifact[] }).artifacts;
}

async function readSandbox(
	runId: string,
	queryKey: readonly unknown[],
): Promise<SandboxRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/sandbox`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<SandboxRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`sandbox failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSandbox;
}

async function readFiles(
	runId: string,
	queryKey: readonly unknown[],
): Promise<FilesRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/files`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<FilesRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
			gone?: boolean;
		} | null;
		return body?.notServed === true
			? "not served"
			: body?.gone === true
				? "gone"
				: "missing";
	}
	if (!response.ok) {
		throw new Error(`files failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { files: RunFile[] }).files;
}

async function readSource(
	runId: string,
	queryKey: readonly unknown[],
): Promise<SourceRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/source`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<SourceRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`source failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSource;
}

async function readRunSettings(
	runId: string,
	queryKey: readonly unknown[],
): Promise<RunSettingsRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/settings`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<RunSettingsRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`run settings failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSettings;
}

async function readArtifact(
	runId: string,
	artifact: Pick<RunArtifact, "folder" | "name">,
	queryKey: readonly unknown[],
): Promise<RunArtifactContent | null> {
	const query = new URLSearchParams({
		folder: artifact.folder,
		name: artifact.name,
	}).toString();
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/artifact?${query}`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<RunArtifactContent | null>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`artifact failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunArtifactContent;
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
			const base = settingsPageOf(loaded).settings;
			const next = {
				...patch(base),
				baselineShowNeedsYou: base.overview.showNeedsYou,
			};
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
				...saved.backends,
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

/** Read one project again. The event stream brings its new rows when the read ends. */
export function useRefreshProject(name: string) {
	return useMutation({
		mutationFn: async (): Promise<void> => {
			const response = await fetch(
				`/api/projects/${encodeURIComponent(name)}/refresh`,
				{ method: "POST" },
			);
			if (!response.ok) {
				throw new Error(`refresh failed (HTTP ${response.status})`);
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
	void pageQueryClient.invalidateQueries({ queryKey: ["run"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["checkpoint"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["agents"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifacts"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifact"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["sandbox"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["files"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["source"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["transcript"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["runSettings"] });
	void pageQueryClient.invalidateQueries(pageQuery.runs);
}

function invalidatePageQueries(): void {
	void pageQueryClient.invalidateQueries(pageQuery.overview);
	void pageQueryClient.invalidateQueries(pageQuery.needsYou);
	void pageQueryClient.invalidateQueries(pageQuery.inbox);
	void pageQueryClient.invalidateQueries(pageQuery.settings);
	void pageQueryClient.invalidateQueries({ queryKey: ["project"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["thread"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["run"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["checkpoint"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["agents"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifacts"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["artifact"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["sandbox"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["files"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["source"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["transcript"] });
	void pageQueryClient.invalidateQueries({ queryKey: ["runSettings"] });
	void pageQueryClient.invalidateQueries(pageQuery.runs);
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
