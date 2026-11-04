import { endedRunStatusKinds } from "./kinds.ts";
import type { FactoryReader } from "./ports.ts";
import type { HistoryRead, RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

/** The most factory reads that the backfill runs at the same time. */
const backfillReads = 2;

const ended: ReadonlySet<string> = new Set(endedRunStatusKinds);

/**
 * Fills the run history of each end of a run once: its stage rows from its
 * event log, its turn rows and its verification record. The reads run in the background, `backfillReads` at a
 * time. A failed read runs again at the next call.
 */
export function historyBackfill(
	history: RunHistory,
	factories: Pick<FactoryReader, "eventLog" | "turns" | "verification">,
) {
	const queued = new Set<string>();
	const waiting: (() => Promise<void>)[] = [];
	let active = 0;
	const pump = () => {
		while (active < backfillReads) {
			const job = waiting.shift();
			if (job === undefined) {
				return;
			}
			active += 1;
			void job()
				.catch(() => {})
				.finally(() => {
					active -= 1;
					pump();
				});
		}
	};
	const readOnce = async (
		runId: string,
		endedAt: string | null,
		read: HistoryRead,
	) => {
		if (read === "events") {
			const answer = await factories.eventLog(runId);
			if (answer !== null) {
				history.recordEventLog(
					runId,
					endedAt,
					answer === "not served" ? null : answer,
				);
			}
			return;
		}
		if (read === "verification") {
			const record = await factories.verification(runId);
			if (record !== null) {
				history.recordVerification(
					runId,
					endedAt,
					record === "not served" ? null : record,
				);
			}
			return;
		}
		const answer = await factories.turns(runId);
		if (answer !== null) {
			history.recordTurns(
				runId,
				endedAt,
				answer === "not served" ? [] : answer,
			);
		}
	};
	return (
		runs: readonly Pick<RunListRow, "id" | "statusKind" | "endedAt">[],
	): void => {
		for (const run of runs) {
			if (!ended.has(run.statusKind)) {
				continue;
			}
			for (const read of history.unread(run.id, run.endedAt)) {
				const key = JSON.stringify([run.id, run.endedAt, read]);
				if (queued.has(key)) {
					continue;
				}
				queued.add(key);
				waiting.push(() =>
					readOnce(run.id, run.endedAt, read).finally(() => queued.delete(key)),
				);
			}
		}
		pump();
	};
}
