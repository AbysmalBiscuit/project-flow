import { queryOptions } from "@tanstack/react-query";

import type { StageTranscript } from "./domain.ts";
import type { TranscriptRead } from "./factory-run-transcript.ts";
import { agentReadMs, pageQueryClient } from "./queries.ts";

/** The page queries of the stage view. */
export const stageQuery = {
	/**
	 * The transcript of one stage. Each read asks only for the entries after the
	 * ones the page holds, and adds them. A live stage reads again on an
	 * interval. An overview event also reads the stage again. All reads stop when
	 * the factory says that the stage has ended.
	 *
	 * `visit` names the visit of the stage and the run status. A later visit or a
	 * resume starts the stage again, so a new `visit` gives a new query. That
	 * query reads on from the cursor of the entries that the page holds.
	 */
	transcript: (runId: string, stage: string, live: boolean, visit: string) => {
		const queryKey = ["transcript", runId, stage, visit];
		return queryOptions({
			queryKey,
			queryFn: () => readTranscript(runId, stage),
			enabled: (query) => !hasEnded(query.state.data),
			refetchInterval: live ? agentReadMs : false,
			placeholderData: (previous: TranscriptRead | undefined) => previous,
		});
	},
};

/** The visit of a stage: its visit count and the run status. */
export function stageVisit(statusKind: string, visits: number): string {
	return `${statusKind}:${visits}`;
}

/** The transcript of the stage that the page holds over all its visits: the one with the furthest cursor. */
function heldTranscript(
	runId: string,
	stage: string,
): StageTranscript | undefined {
	return pageQueryClient
		.getQueriesData<TranscriptRead>({ queryKey: ["transcript", runId, stage] })
		.flatMap(([, read]) => (typeof read === "object" ? [read] : []))
		.reduce<StageTranscript | undefined>(
			(furthest, read) =>
				furthest === undefined || read.next > furthest.next ? read : furthest,
			undefined,
		);
}

function hasEnded(read: TranscriptRead | undefined): boolean {
	return typeof read === "object" && read.ended;
}

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
): Promise<TranscriptRead> {
	const held = heldTranscript(runId, stage);
	const query = new URLSearchParams({
		stage,
		after: String(held?.next ?? 0),
	}).toString();
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/transcript?${query}`,
	);
	if (response.status === 404) {
		return absentRead(response);
	}
	if (!response.ok) {
		throw new Error(`transcript failed (HTTP ${response.status})`);
	}
	const page = (await response.json()) as StageTranscript;
	const heldIds = new Set(held?.entries.map((entry) => entry.id));
	return {
		entries: [
			...(held?.entries ?? []),
			...page.entries.filter((entry) => !heldIds.has(entry.id)),
		],
		next: Math.max(page.next, held?.next ?? 0),
		ended: page.ended,
	};
}
