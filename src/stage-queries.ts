import { queryOptions } from "@tanstack/react-query";

import type { StageTranscript } from "./domain.ts";
import type { TranscriptRead } from "./factory-run-transcript.ts";
import { agentReadMs, heldData } from "./queries.ts";

/** The page queries of the stage view. */
export const stageQuery = {
	/**
	 * The transcript of one stage. Each read asks only for the entries after the
	 * ones the page holds, and adds them. A live stage reads again on an
	 * interval. An overview event also reads the stage again. All reads stop when
	 * the factory says that the stage has ended.
	 */
	transcript: (runId: string, stage: string, live: boolean) => {
		const queryKey = ["transcript", runId, stage];
		return queryOptions({
			queryKey,
			queryFn: () => readTranscript(runId, stage, queryKey),
			enabled: (query) => !hasEnded(query.state.data),
			refetchInterval: live ? agentReadMs : false,
		});
	},
};

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
		ended: page.ended,
	};
}
