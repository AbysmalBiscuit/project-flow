import { queryOptions } from "@tanstack/react-query";

import type { ShownFactoryRun, StageTranscript } from "./domain.ts";
import type { ContextRead, TranscriptRead } from "./factory-run-transcript.ts";
import { agentReadMs, heldData, PendingRead, pendingRetry } from "./queries.ts";
import { pendingStatus } from "./stale-reads.ts";

/** The page queries of the stage view. An overview event reads each of them again. */
export const stageQuery = {
	/**
	 * The transcript of one stage. Each read asks only for the entries after the
	 * ones the page holds, and adds them. A live stage reads again on an interval.
	 */
	transcript: (runId: string, stage: string, live: boolean) => {
		const queryKey = ["transcript", runId, stage];
		return queryOptions({
			queryKey,
			queryFn: () => readTranscript(runId, stage, queryKey),
			...pendingRetry,
			refetchInterval: live ? agentReadMs : false,
		});
	},
	/** The key holds the run's status and stage, so a stage that ends reads the run context again. */
	context: (run: Pick<ShownFactoryRun, "id" | "statusKind" | "stage">) => {
		const queryKey = ["context", run.id, run.statusKind, run.stage ?? null];
		return queryOptions({
			queryKey,
			queryFn: () => readContext(run.id, queryKey),
			...pendingRetry,
			placeholderData: (previous: ContextRead | undefined) => previous,
		});
	},
};

/** The read that a 404 answer stands for: a route the factory does not serve, or no run. */
async function absentRead(
	response: Response,
): Promise<"not served" | "missing"> {
	const body = (await response.json().catch(() => null)) as {
		notServed?: boolean;
	} | null;
	return body?.notServed === true ? "not served" : "missing";
}

async function readTranscript(
	runId: string,
	stage: string,
	queryKey: readonly unknown[],
): Promise<TranscriptRead> {
	const held = heldData<TranscriptRead>(queryKey);
	const query = new URLSearchParams({
		stage,
		after: String(typeof held === "object" ? held.next : 0),
	}).toString();
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/transcript?${query}`,
	);
	if (response.status === pendingStatus) {
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		return absentRead(response);
	}
	if (!response.ok) {
		throw new Error(`transcript failed (HTTP ${response.status})`);
	}
	const page = (await response.json()) as StageTranscript;
	return {
		entries: [
			...(typeof held === "object" ? held.entries : []),
			...page.entries,
		],
		next: page.next,
	};
}

async function readContext(
	runId: string,
	queryKey: readonly unknown[],
): Promise<ContextRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/context`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<ContextRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		return absentRead(response);
	}
	if (!response.ok) {
		throw new Error(`context failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { context: Record<string, unknown> })
		.context;
}
