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
	 * query reads on from the cursor of the entries that the page holds. Until
	 * its first read lands, it shows those entries as a stage that has not ended.
	 */
	transcript: (runId: string, stage: string, live: boolean, visit: string) => {
		const queryKey = ["transcript", runId, stage, visit];
		return queryOptions({
			queryKey,
			queryFn: () => readTranscript(runId, stage),
			enabled: (query) => !hasEnded(query.state.data),
			refetchInterval: live ? agentReadMs : false,
			placeholderData: (previous: TranscriptRead | undefined) =>
				typeof previous === "object" ? { ...previous, ended: false } : previous,
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

/** One page of the transcript after the cursor `after`. */
async function readPage(
	runId: string,
	stage: string,
	after: number,
): Promise<StageTranscript | "not served" | "missing"> {
	const query = new URLSearchParams({ stage, after: String(after) }).toString();
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/transcript?${query}`,
	);
	if (response.status === 404) {
		return absentRead(response);
	}
	if (!response.ok) {
		throw new Error(`transcript failed (HTTP ${response.status})`);
	}
	return (await response.json()) as StageTranscript;
}

/**
 * The entries after the ones the page holds. The factory gives one page for
 * each read, so the read goes on with `next` until the stage has ended or a
 * page moves the cursor no further.
 */
async function readTranscript(
	runId: string,
	stage: string,
): Promise<TranscriptRead> {
	const held = heldTranscript(runId, stage);
	const read: StageTranscript = {
		entries: [...(held?.entries ?? [])],
		next: held?.next ?? 0,
		ended: false,
	};
	const seen = new Set(read.entries.map((entry) => entry.id));
	while (true) {
		const page = await readPage(runId, stage, read.next);
		if (typeof page !== "object") {
			return page;
		}
		read.entries.push(...page.entries.filter((entry) => !seen.has(entry.id)));
		for (const entry of page.entries) {
			seen.add(entry.id);
		}
		read.ended = page.ended;
		if (page.ended || page.next <= read.next) {
			read.next = Math.max(read.next, page.next);
			return read;
		}
		read.next = page.next;
	}
}
