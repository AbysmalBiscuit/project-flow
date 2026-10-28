import { z } from "zod";

import type { StageTranscript, TranscriptEntry } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type TranscriptRead = StageTranscript | "missing" | "not served";

export type ContextRead = Record<string, unknown> | "missing" | "not served";

const entryFacts = {
	id: z.number(),
	stage: z.string(),
	visit: z.number(),
	attempt: z.number(),
	recorded_at: z.string(),
};

const entry = z.discriminatedUnion("kind", [
	z.object({ ...entryFacts, kind: z.literal("message"), text: z.string() }),
	z.object({
		...entryFacts,
		kind: z.literal("tool_call"),
		name: z.string(),
		input: z.string(),
		truncated: z.boolean(),
	}),
]);

/** `GET /runs/{id}/stages/{node_path}/transcript`: a page of entries, oldest first. */
const transcript = z.object({
	entries: z.array(z.unknown()),
	next: z.number(),
});

/** `GET /runs/{id}/context`: the context values of the newest run checkpoint. */
const context = z.record(z.string(), z.unknown());

/** An entry of a kind that Project Flow does not know drops, so the rest of the page still shows. */
function shownEntry(raw: unknown): TranscriptEntry[] {
	const parsed = entry.safeParse(raw);
	if (!parsed.success) {
		return [];
	}
	const { stage, recorded_at, ...rest } = parsed.data;
	return [{ ...rest, folder: stage, at: recorded_at }];
}

/**
 * The stage transcript and the run context of a run, from the hub that
 * reports the run, or else from its box. The hub relays each read to the box.
 */
export function runTranscriptReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	const readOf = async <T>(
		runId: string,
		path: string,
		schema: z.ZodType<T>,
	): Promise<T | "missing" | "not served"> => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		try {
			return await body(
				await reader(
					fetchImpl,
					target.url,
					signal,
				)(`/runs/${encodeURIComponent(runId)}${path}`),
				schema,
			);
		} catch (error) {
			if (error instanceof NotServed) {
				return "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
	const transcriptOf = async (
		runId: string,
		stage: string,
		after: number,
	): Promise<TranscriptRead> => {
		const nodePath = stage.split("/").map(encodeURIComponent).join("/");
		const found = await readOf(
			runId,
			`/stages/${nodePath}/transcript?after=${after}`,
			transcript,
		);
		return typeof found === "string"
			? found
			: { entries: found.entries.flatMap(shownEntry), next: found.next };
	};
	return {
		transcript: transcriptOf,
		context: (runId: string): Promise<ContextRead> =>
			readOf(runId, "/context", context),
	};
}
