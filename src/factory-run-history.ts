import { sseFrames } from "./factory-events.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import { turnsOf } from "./factory-run-detail.ts";
import { runEventFrame } from "./factory-run-events.ts";
import { runPull } from "./factory-run-pulls.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import { type RetroRecord, retroRecord } from "./retros-page.ts";
import type { StageEvent } from "./run-history.ts";
import type { RecordedTurn } from "./run-usage.ts";
import {
	type VerificationRecord,
	verificationRecord,
} from "./verification-page.ts";

/** An ended run's event log can be long, so its read gets more time than a plain read. */
const eventLogLimitMs = 30_000;

/** A read of an ended run for the run history: its answer, "not served" on 404, or null when it failed. */
export type HistoryAnswer<T> = T | "not served" | null;

/** The PR that a run opened, as its factory reports it. */
export type FactoryPull = {
	repo: string;
	number: number;
	url: string;
	/** True when the run recorded the merge of its PR. */
	merged: boolean;
};

/** The one-time reads of an ended run that fill the run history. */
export function runHistoryReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	return {
		eventLog: async (runId: string): Promise<HistoryAnswer<StageEvent[]>> => {
			const { hubRow, row } = statusRowOf(runId);
			const target = hubRow ?? row;
			if (target === undefined) {
				return null;
			}
			const read = reader(fetchImpl, target.url, signal, eventLogLimitMs);
			try {
				const response = await read(
					`/runs/${encodeURIComponent(runId)}/events`,
				);
				if (response.status === 404) {
					return "not served";
				}
				if (!response.ok || response.body === null) {
					return null;
				}
				const events: StageEvent[] = [];
				for await (const frame of sseFrames(response.body, runEventFrame)) {
					events.push({
						event: frame.item.event,
						stage: frame.item.node_path,
						at: frame.recorded_at,
						data: frame.item.data,
					});
				}
				return events;
			} catch {
				return null;
			}
		},
		turns: async (runId: string): Promise<HistoryAnswer<RecordedTurn[]>> => {
			const { row } = statusRowOf(runId);
			if (row === undefined) {
				return null;
			}
			try {
				return await turnsOf(reader(fetchImpl, row.url, signal), runId);
			} catch (error) {
				if (error instanceof NotServed) {
					return "not served";
				}
				if (error instanceof Unreachable) {
					return null;
				}
				throw error;
			}
		},
		verification: async (
			runId: string,
		): Promise<HistoryAnswer<VerificationRecord>> => {
			const { row } = statusRowOf(runId);
			if (row === undefined) {
				return null;
			}
			try {
				return await body(
					await reader(
						fetchImpl,
						row.url,
						signal,
					)(`/runs/${encodeURIComponent(runId)}/verification`),
					verificationRecord,
				);
			} catch (error) {
				if (error instanceof NotServed) {
					return "not served";
				}
				if (error instanceof Unreachable) {
					return null;
				}
				throw error;
			}
		},
		pull: async (
			runId: string,
		): Promise<HistoryAnswer<FactoryPull | "no pull">> => {
			const { row } = statusRowOf(runId);
			if (row === undefined) {
				return null;
			}
			try {
				const pull = await body(
					await reader(
						fetchImpl,
						row.url,
						signal,
					)(`/runs/${encodeURIComponent(runId)}`),
					runPull,
				);
				return pull ?? "no pull";
			} catch (error) {
				if (error instanceof NotServed) {
					return "not served";
				}
				if (error instanceof Unreachable) {
					return null;
				}
				throw error;
			}
		},
		retro: async (runId: string): Promise<HistoryAnswer<RetroRecord>> => {
			const { row } = statusRowOf(runId);
			if (row === undefined) {
				return null;
			}
			try {
				return await body(
					await reader(
						fetchImpl,
						row.url,
						signal,
					)(`/runs/${encodeURIComponent(runId)}/retro`),
					retroRecord,
				);
			} catch (error) {
				if (error instanceof NotServed) {
					return "not served";
				}
				if (error instanceof Unreachable) {
					return null;
				}
				throw error;
			}
		},
	};
}
