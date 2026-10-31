import { z } from "zod";

import type { RunPull } from "./domain.ts";
import { body, type Read, reader, Unreachable } from "./factory-http.ts";
import { isLive, type ReadRun } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import { githubHost } from "./github-pin.ts";

/** `GET /runs/{id}`: the PR that the run opened, and its outputs. */
const runPull = z.object({
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

/** The PR of each run from `GET /runs/{id}` of the factory that reports the run. */
export function runPullReader(fetchImpl: Fetch, signal: AbortSignal) {
	/** The PR of each run that has one, by run id, with the end time of the run at the read. */
	const pulls = new Map<string, { endedAt: string | null; pull?: RunPull }>();
	/** The factories whose PR reads run now. */
	const readingPulls = new Set<string>();
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
							pull: {
								repo: `${pr.owner}/${pr.repo}`,
								...declaredHost(pr.url),
								number: pr.number,
								url: pr.url,
								merged: (outputs?.merge_sha ?? "") !== "",
							},
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
		});
	};
	const pullOf = (runId: string): RunPull | undefined => pulls.get(runId)?.pull;
	return { readPullsOf, pullOf };
}
