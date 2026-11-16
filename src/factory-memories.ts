import type { z } from "zod";

import type { Factory } from "./configuration.ts";
import type { FactoryRun } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import { levSender, reasonOf } from "./factory-run-actions.ts";
import type { HistoryAnswer } from "./factory-run-history.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";
import {
	type MemoryCorrectionRequest,
	type MemoryHistory,
	memoryHistory,
	type MemoryReview,
	memoryReview,
	type MemoryStance,
	type MemoryWriteResult,
	type MergeBody,
} from "./memories-page.ts";

/** The memory reads, the vote and the corrections of a repo, on the factory whose row gives the newest run of the repo its status. */
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

	const write = async (
		repo: string,
		path: string,
		json: unknown,
		refusal: string,
	): Promise<MemoryWriteResult> => {
		const url = factoryOf(repo);
		if (url === undefined) {
			return null;
		}
		try {
			const response = await reader(
				deps.fetchImpl,
				url,
				deps.signal,
			)(path, { json });
			if (!response.ok) {
				const reason = await reasonOf(response);
				if (reason !== undefined) {
					return { refused: reason };
				}
				if (response.status === 404) {
					return "not served";
				}
				return response.status < 500 ? { refused: refusal } : null;
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
	};

	const repoPath = (repo: string): string => {
		const [owner = "", ...names] = repo.split("/");
		return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(names.join("/"))}`;
	};

	const memoryPath = (repo: string, memoryId: string): string =>
		`${repoPath(repo)}/memories/${encodeURIComponent(memoryId)}`;

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
			answer(repo, memoryPath(repo, memoryId), memoryHistory),
		/** `POST /repos/{owner}/{name}/memories/{id}/votes` of the factory that reports the repo, as Lev. */
		vote: (
			repo: string,
			memoryId: string,
			stance: MemoryStance,
		): Promise<MemoryWriteResult> =>
			write(
				repo,
				`${memoryPath(repo, memoryId)}/votes`,
				{ voter: levSender, stance },
				"the factory refused the vote",
			),
		/** `POST /repos/{owner}/{name}/memories/{id}/{correction}` of the factory that reports the repo, as Lev. */
		correct: (
			repo: string,
			memoryId: string,
			request: MemoryCorrectionRequest,
		): Promise<MemoryWriteResult> => {
			const path = `${memoryPath(repo, memoryId)}/${request.correction}`;
			const refusal = "the factory refused the correction";
			switch (request.correction) {
				case "supersede":
					return write(
						repo,
						path,
						{
							text: request.text,
							evidence: request.evidence,
							author: levSender,
						},
						refusal,
					);
				case "undo":
				case "suppress":
					return write(repo, path, { person: levSender }, refusal);
				case "restore":
					return write(repo, path, {}, refusal);
			}
		},
		/** `POST /repos/{owner}/{name}/memories/merges` of the factory that reports the repo, as Lev. */
		merge: (repo: string, merge: MergeBody): Promise<MemoryWriteResult> =>
			write(
				repo,
				`${repoPath(repo)}/memories/merges`,
				{ text: merge.text, author: levSender, memories: merge.memories },
				"the factory refused the merge",
			),
	};
}
