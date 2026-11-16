import type { z } from "zod";

import type { Factory } from "./configuration.ts";
import type { FactoryRun } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import { levSender, reasonOf } from "./factory-run-actions.ts";
import type { HistoryAnswer } from "./factory-run-history.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import {
	type MemoryHistory,
	memoryHistory,
	type MemoryReview,
	memoryReview,
	type MemoryStance,
	type MemoryVoteResult,
} from "./memories-page.ts";

/** The memory reads and the vote of a repo, on the factory whose row gives the newest run of the repo its status. */
export function factoryMemoryReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	runs: () => FactoryRun[];
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
	listed: () => Factory[];
}) {
	const factoryOf = (repo: string): string | undefined => {
		const run = deps.runs().find((candidate) => candidate.repo === repo);
		return run === undefined ? undefined : deps.statusRowOf(run.id).row?.url;
	};

	const answer = async <T>(
		repo: string,
		path: string,
		schema: z.ZodType<T>,
	): Promise<HistoryAnswer<T>> => {
		const url = factoryOf(repo);
		if (url === undefined) {
			return null;
		}
		try {
			return await body(
				await reader(deps.fetchImpl, url, deps.signal)(path),
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
		/** The name of the factory that the memory reads of the repo go to. Null when no run of the repo has a status row. */
		memoryFactory: (repo: string): string | null => {
			const url = factoryOf(repo);
			return deps.listed().find((factory) => factory.url === url)?.name ?? null;
		},
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
		/** `POST /repos/{owner}/{name}/memories/{id}/votes` of the factory that reports the repo, as Lev. */
		vote: async (
			repo: string,
			memoryId: string,
			stance: MemoryStance,
		): Promise<MemoryVoteResult> => {
			const url = factoryOf(repo);
			if (url === undefined) {
				return null;
			}
			const path = `${repoPath(repo)}/memories/${encodeURIComponent(memoryId)}/votes`;
			try {
				const response = await reader(
					deps.fetchImpl,
					url,
					deps.signal,
				)(path, {
					json: { voter: levSender, stance },
				});
				if (response.status === 404) {
					return "not served";
				}
				if (response.status >= 400 && response.status < 500) {
					return {
						refused:
							(await reasonOf(response)) ?? "the factory refused the vote",
					};
				}
				if (!response.ok) {
					return null;
				}
				const parsed = memoryHistory.safeParse(
					await response.json().catch(() => null),
				);
				return parsed.success ? parsed.data : null;
			} catch (error) {
				if (error instanceof Unreachable) {
					return null;
				}
				throw error;
			}
		},
	};
}
