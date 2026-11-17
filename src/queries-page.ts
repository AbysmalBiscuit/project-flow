import { queryOptions } from "@tanstack/react-query";

import { readSettings, type SettingsRead } from "./client-settings.ts";
import type {
	InboxEntry,
	NeedsYouItem,
	Overview,
	RunArtifact,
	RunDetail,
	ShownFactoryRun,
} from "./domain.ts";
import {
	type FactoriesPage,
	factoryCheckMs,
	type RangeDays,
} from "./factories-page.ts";
import type { ArtifactsRead } from "./factory-run-artifacts.ts";
import type { CheckpointRead } from "./factory-run-detail.ts";
import type { FilesRead } from "./factory-run-files.ts";
import type { SandboxRead } from "./factory-run-sandbox.ts";
import type { RunSettingsRead } from "./factory-run-settings.ts";
import type { SourceRead } from "./factory-run-source.ts";
import { liveRunStatusKinds } from "./kinds.ts";
import type { MemoriesPage, MemoryHistoryAnswer } from "./memories-page.ts";
import { fetchJson } from "./queries-client.ts";
import {
	PendingRead,
	readAgents,
	readArtifact,
	readArtifacts,
	readCheckpoint,
	readFiles,
	readProject,
	readRun,
	readRunSettings,
	readSandbox,
	readSource,
	readThread,
	type ThreadRead,
} from "./queries-reads.ts";
import { memoryPath, settingsPageOf } from "./queries-shapes.ts";
import type { RetrosPage, RunRetro } from "./retros-page.ts";
import type { InsightTables } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";
import type { SavedInsights } from "./saved-insights.ts";
import type { RunVerification, VerificationPage } from "./verification-page.ts";
import type { WorkflowDetail, WorkflowsPage } from "./workflows-page.ts";

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
	thread: (tracker: string, project: string, key: string, host?: string) => {
		const queryKey = ["thread", tracker, project, key, host];
		return queryOptions({
			queryKey,
			queryFn: () => readThread(tracker, project, key, host, queryKey),
			placeholderData: (previous: ThreadRead | undefined) => previous,
		});
	},
	insightTables: queryOptions({
		queryKey: ["insight-tables"],
		queryFn: () => fetchJson<InsightTables>("/api/insights"),
	}),
	/** A change in the factory feed reads the Factories tab again, and so does the factory check interval. */
	factories: (outcomeDays: RangeDays, stageDays: RangeDays) =>
		queryOptions({
			queryKey: ["factories", outcomeDays, stageDays],
			queryFn: () =>
				fetchJson<FactoriesPage>(
					`/api/factories?outcomeDays=${outcomeDays}&stageDays=${stageDays}`,
				),
			refetchInterval: factoryCheckMs,
			placeholderData: (previous: FactoriesPage | undefined) => previous,
		}),
	workflows: queryOptions({
		queryKey: ["workflows"],
		queryFn: () => fetchJson<WorkflowsPage>("/api/workflows"),
		placeholderData: (previous: WorkflowsPage | undefined) => previous,
	}),
	workflow: (name: string, sha: string | null) =>
		queryOptions({
			queryKey: ["workflow", name, sha],
			queryFn: () =>
				fetchJson<WorkflowDetail>(
					`/api/workflows/${encodeURIComponent(name)}${sha === null ? "" : `?sha=${encodeURIComponent(sha)}`}`,
				),
			placeholderData: (previous: WorkflowDetail | undefined) => previous,
		}),
	/** A change in the factory feed reads the Verification tab again. */
	verification: queryOptions({
		queryKey: ["verification"],
		queryFn: () => fetchJson<VerificationPage>("/api/verification"),
		placeholderData: (previous: VerificationPage | undefined) => previous,
	}),
	verificationRun: (runId: string) =>
		queryOptions({
			queryKey: ["verification", "run", runId],
			queryFn: () =>
				fetchJson<RunVerification>(
					`/api/verification/runs/${encodeURIComponent(runId)}`,
				),
		}),
	/** A change in the factory feed reads the Retros tab again. */
	retros: (roughOrWorse: boolean) =>
		queryOptions({
			queryKey: ["retros", roughOrWorse],
			queryFn: () =>
				fetchJson<RetrosPage>(
					roughOrWorse ? "/api/retros?atLeast=rough" : "/api/retros",
				),
			placeholderData: (previous: RetrosPage | undefined) => previous,
		}),
	retrosRun: (runId: string) =>
		queryOptions({
			queryKey: ["retros", "run", runId],
			queryFn: () =>
				fetchJson<RunRetro>(`/api/retros/runs/${encodeURIComponent(runId)}`),
		}),
	memories: queryOptions({
		queryKey: ["memories"],
		queryFn: () => fetchJson<MemoriesPage>("/api/memories"),
		placeholderData: (previous: MemoriesPage | undefined) => previous,
	}),
	memory: (repo: string, memoryId: string) =>
		queryOptions({
			queryKey: ["memories", repo, memoryId],
			queryFn: () => fetchJson<MemoryHistoryAnswer>(memoryPath(repo, memoryId)),
		}),
	savedInsights: queryOptions({
		queryKey: ["saved-insights"],
		queryFn: () => fetchJson<SavedInsights>("/api/insights/saved"),
	}),
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
