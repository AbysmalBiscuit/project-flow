import { z } from "zod";

import type { RunPull } from "./domain.ts";
import { body, type Read, reader, Unreachable } from "./factory-http.ts";
import type { FactoryPull } from "./factory-run-history.ts";
import { isLive, type ReadRun } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import { githubHost } from "./github-pin.ts";
import { WatchedMap } from "./watched.ts";

/** `GET /runs/{id}`: the PR that the run opened, and its outputs. */
export const runPull = z.object({
	pr: z
		.object({
			owner: z.string(),
			repo: z.string(),
			number: z.number(),
			url: z.string(),
		})
		.nullish(),
	outputs: z.object({ merge_sha: z.string().nullish() }).nullish(),
});

/** The host of a PR URL, for a PR off github.com. */
function declaredHost(url: string): { host?: string } {
	const host = URL.parse(url)?.host;
	return host === undefined || host === githubHost ? {} : { host };
}

/** The run PR of the PR that a factory reports. */
export function runPullOf(pull: FactoryPull): RunPull {
	return {
		repo: pull.repo,
		...declaredHost(pull.url),
		number: pull.number,
		url: pull.url,
		merged: pull.merged,
	};
}

/** The PR read of an ended run that an earlier launch stored: the run's end time at the read, and its PR, or null when it opened none. */
export type KnownPull = {
	runId: string;
	endedAt: string | null;
	pull: FactoryPull | null;
};

/**
 * The PR of each run from `GET /runs/{id}` of the factory that reports the run.
 * It starts from the PRs in `known`, so it does not read an ended run again after a restart.
 */
export function runPullReader(
	fetchImpl: Fetch,
	signal: AbortSignal,
	changed: () => void,
	known: readonly KnownPull[] = [],
) {
	/** The PR of each run that has one, by run id, with the end time of the run at the read. */
	const pulls = new WatchedMap<
		string,
		{ endedAt: string | null; pull?: RunPull }
	>(changed);
	for (const { runId, endedAt, pull } of known) {
		pulls.set(runId, {
			endedAt,
			...(pull === null ? {} : { pull: runPullOf(pull) }),
		});
	}
	/** The factories whose PR reads run now. */
	const readingPulls = new Set<string>();
	/** The factories that ended at least one pass of PR reads. */
	const passedPulls = new Set<string>();
	const readPull = async (read: Read, run: ReadRun["run"]): Promise<void> => {
		try {
			const { pr, outputs } = await body(
				await read(`/runs/${encodeURIComponent(run.id)}`),
				runPull,
			);
			pulls.set(run.id, {
				endedAt: run.endedAt,
				...(pr === null || pr === undefined
					? {}
					: {
							pull: runPullOf({
								repo: `${pr.owner}/${pr.repo}`,
								number: pr.number,
								url: pr.url,
								merged: (outputs?.merge_sha ?? "") !== "",
							}),
						}),
			});
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
		}
	};
	/**
	 * Reads the PR of each live run, and of each ended run once. The reads go one at a
	 * time and apart from the `GET /runs` read, so a long run history does not hold up
	 * the run list.
	 */
	const readPullsOf = (url: string, rows: ReadRun[]): void => {
		const wanted = rows.filter(
			({ run }) =>
				isLive(run.statusKind) ||
				(run.statusKind !== "queued" &&
					pulls.get(run.id)?.endedAt !== run.endedAt),
		);
		if (wanted.length === 0 || readingPulls.has(url)) {
			return;
		}
		readingPulls.add(url);
		const read = reader(fetchImpl, url, signal);
		void (async () => {
			for (const { run } of wanted) {
				await readPull(read, run);
			}
		})().finally(() => {
			readingPulls.delete(url);
			if (!passedPulls.has(url)) {
				passedPulls.add(url);
				changed();
			}
		});
	};
	const pullOf = (runId: string): RunPull | undefined => pulls.get(runId)?.pull;
	const firstPullsRun = (): boolean =>
		[...readingPulls].some((url) => !passedPulls.has(url));
	return { readPullsOf, pullOf, firstPullsRun };
}
