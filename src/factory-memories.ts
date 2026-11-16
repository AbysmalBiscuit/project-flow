import type { z } from "zod";

import type { FactoryRun } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { HistoryAnswer } from "./factory-run-history.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import {
	type MemoryHistory,
	memoryHistory,
	type MemoryReview,
	memoryReview,
	type MemoryVote,
} from "./memories-page.ts";

/** The memory reads and the vote of a repo, on the factory whose row gives the newest run of the repo its status. */
export function factoryMemoryReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	runs: () => FactoryRun[];
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const factoryOf = (repo: string): string | undefined => {
		const run = deps.runs().find((candidate) => candidate.repo === repo);
		return run === undefined ? undefined : deps.statusRowOf(run.id).row?.url;
	};

	const answer = async <T>(
		repo: string,
		path: string,
		schema: z.ZodType<T>,
		send?: { json: unknown },
	): Promise<HistoryAnswer<T>> => {
		const url = factoryOf(repo);
		if (url === undefined) {
			return null;
		}
		try {
			return await body(
				await reader(deps.fetchImpl, url, deps.signal)(path, send),
				schema,
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
	};

	const repoPath = (repo: string): string => {
		const [owner = "", ...names] = repo.split("/");
		return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(names.join("/"))}`;
	};

	return {
		/** `GET /repos/{owner}/{name}/memories` of the factory that reports the repo. */
		memories: (repo: string): Promise<HistoryAnswer<MemoryReview>> =>
			answer(repo, `${repoPath(repo)}/memories`, memoryReview),
		/** `GET /repos/{owner}/{name}/memories/{id}` of the factory that reports the repo. */
		memory: (
			repo: string,
			memoryId: string,
		): Promise<HistoryAnswer<MemoryHistory>> =>
			answer(
				repo,
				`${repoPath(repo)}/memories/${encodeURIComponent(memoryId)}`,
				memoryHistory,
			),
		/** `POST /repos/{owner}/{name}/memories/{id}/votes` of the factory that reports the repo. */
		vote: (
			repo: string,
			memoryId: string,
			vote: MemoryVote,
		): Promise<HistoryAnswer<MemoryHistory>> =>
			answer(
				repo,
				`${repoPath(repo)}/memories/${encodeURIComponent(memoryId)}/votes`,
				memoryHistory,
				{ json: vote },
			),
	};
}
