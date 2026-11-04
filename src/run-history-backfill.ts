import { endedRunStatusKinds } from "./kinds.ts";
import type { FactoryReader } from "./ports.ts";
import type { HistoryRead, RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

/** The most factory reads that the backfill runs at the same time. */
const backfillReads = 2;

const ended: ReadonlySet<string> = new Set(endedRunStatusKinds);

/**
 * Fills the run history of each ended run once: its stage rows from its event
 * log, and its turn rows. The reads run in the background, `backfillReads` at a
 * time. A failed read runs again at the next call.
 */
export function historyBackfill(
	history: RunHistory,
	factories: Pick<FactoryReader, "eventLog" | "turns">,
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
	const readOnce = async (runId: string, read: HistoryRead) => {
		if (read === "events") {
			const answer = await factories.eventLog(runId);
			if (answer !== null) {
				history.recordEventLog(runId, answer === "not served" ? null : answer);
			}
			return;
		}
		const answer = await factories.turns(runId);
		if (answer !== null) {
			history.recordTurns(runId, answer === "not served" ? [] : answer);
		}
	};
	return (runs: readonly Pick<RunListRow, "id" | "statusKind">[]): void => {
		for (const run of runs) {
			if (!ended.has(run.statusKind)) {
				continue;
			}
			for (const read of history.unread(run.id)) {
				const key = JSON.stringify([run.id, read]);
				if (queued.has(key)) {
					continue;
				}
				queued.add(key);
				waiting.push(() =>
					readOnce(run.id, read).finally(() => queued.delete(key)),
				);
			}
		}
		pump();
	};
}
