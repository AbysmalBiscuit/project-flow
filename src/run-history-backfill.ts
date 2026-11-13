import type { FactoryPull } from "./factory-run-history.ts";
import { endedRunStatusKinds } from "./kinds.ts";
import {
	type FactoryReader,
	type Forge,
	type PullTarget,
	RateLimited,
} from "./ports.ts";
import type { HistoryRead, RecordedPull, RunHistory } from "./run-history.ts";
import type { RunListRow } from "./run-list.ts";

/** The most factory reads that the backfill runs at the same time. */
const backfillReads = 2;

const ended: ReadonlySet<string> = new Set(endedRunStatusKinds);

/**
 * Fills the run history of each end of a run once: its stage rows from its
 * event log, its turn rows, its verification record, its retro and the size of its PR. The reads run in the background, `backfillReads` at a
 * time. A failed read runs again at the next call, and `warn` gets its reason when the reason changes.
 * A rate-limited PR size read stops the PR reads until the forge takes reads again.
 */
export function historyBackfill(
	history: RunHistory,
	factories: Pick<
		FactoryReader,
		"eventLog" | "turns" | "verification" | "retro" | "pull"
	>,
	forgeOfPull: (url: URL) => { forge: Forge; target: PullTarget } | null,
	options: { now: () => Date; warn: (line: string) => void },
) {
	/** The reason of the last failure of each read, so a read that keeps failing warns once. */
	const failures = new Map<HistoryRead, string>();
	/** The time when the forge takes PR size reads again, after a rate limit refused one. */
	let pullsWaitUntil: Date | null = null;
	const readPull = async (pull: FactoryPull): Promise<RecordedPull> => {
		const parsed = URL.parse(pull.url);
		const link = parsed === null ? null : forgeOfPull(parsed);
		const size =
			link === null
				? null
				: ((await link.forge.pullSize?.(link.target)) ?? null);
		return { ...pull, size };
	};
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
			void job().finally(() => {
				active -= 1;
				pump();
			});
		}
	};
	const failed = (read: HistoryRead, runId: string, error: unknown) => {
		if (error instanceof RateLimited) {
			if (pullsWaitUntil?.getTime() !== error.retryAt.getTime()) {
				options.warn(
					`run history: the forge rate limit stops PR size reads until ${error.retryAt.toISOString()}`,
				);
			}
			pullsWaitUntil = error.retryAt;
			return;
		}
		const reason = error instanceof Error ? error.message : String(error);
		if (failures.get(read) !== reason) {
			options.warn(
				`run history: the ${read} read of run ${runId} failed: ${reason}`,
			);
			failures.set(read, reason);
		}
	};
	const pullsWait = () =>
		pullsWaitUntil !== null && options.now() < pullsWaitUntil;
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
		if (read === "pull") {
			if (pullsWait()) {
				return;
			}
			const pull = await factories.pull(runId);
			if (pull !== null) {
				history.recordPull(
					runId,
					endedAt,
					pull === "not served" || pull === "no pull"
						? null
						: await readPull(pull),
				);
			}
			return;
		}
		if (read === "retro") {
			const retro = await factories.retro(runId);
			if (retro !== null) {
				history.recordRetro(
					runId,
					endedAt,
					retro === "not served" ? null : retro,
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
		const waitForPulls = pullsWait();
		for (const run of runs) {
			if (!ended.has(run.statusKind)) {
				continue;
			}
			for (const read of history.unread(run.id, run.endedAt)) {
				const key = JSON.stringify([run.id, run.endedAt, read]);
				if (queued.has(key) || (read === "pull" && waitForPulls)) {
					continue;
				}
				queued.add(key);
				waiting.push(() =>
					readOnce(run.id, run.endedAt, read)
						.then(
							() => {
								failures.delete(read);
							},
							(error: unknown) => failed(read, run.id, error),
						)
						.finally(() => queued.delete(key)),
				);
			}
		}
		pump();
	};
}
