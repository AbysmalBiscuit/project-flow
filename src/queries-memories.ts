import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
	MemoryCorrectionRequest,
	MemoryHistoryAnswer,
	MemoryStance,
	MergeBody,
} from "./memories-page.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { pageQuery } from "./queries-page.ts";
import { memoriesPath, memoryPath } from "./queries-shapes.ts";

async function postMemory(
	path: string,
	body: unknown,
	failed: string,
): Promise<MemoryHistoryAnswer> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const reply = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(reply?.error ?? failed);
	}
	return (await response.json()) as MemoryHistoryAnswer;
}

function useStoreMemoryAnswer(repo: string) {
	const queries = useQueryClient();
	return (answer: MemoryHistoryAnswer) => {
		if (answer.memory !== null) {
			queries.setQueryData(
				pageQuery.memory(repo, answer.memory.id).queryKey,
				answer,
			);
		}
		void queries.invalidateQueries({ queryKey: ["memories"] });
	};
}

export function useMemoryVote(repo: string, memoryId: string) {
	const storeAnswer = useStoreMemoryAnswer(repo);
	return useMutation({
		mutationFn: (stance: MemoryStance) =>
			postMemory(
				`${memoryPath(repo, memoryId)}/votes`,
				{ stance },
				memoriesCopy.voteFailed,
			),
		onSuccess: storeAnswer,
	});
}

export function useMemoryCorrection(repo: string, memoryId: string) {
	const storeAnswer = useStoreMemoryAnswer(repo);
	return useMutation({
		mutationFn: (request: MemoryCorrectionRequest) =>
			postMemory(
				`${memoryPath(repo, memoryId)}/${request.correction}`,
				request.correction === "supersede"
					? { text: request.text, evidence: request.evidence }
					: {},
				memoriesCopy.correctionFailed,
			),
		onSuccess: storeAnswer,
	});
}

export function useMemoryMerge(repo: string) {
	const storeAnswer = useStoreMemoryAnswer(repo);
	return useMutation({
		mutationFn: (merge: MergeBody) =>
			postMemory(
				`${memoriesPath(repo)}/merges`,
				merge,
				memoriesCopy.mergeFailed,
			),
		onSuccess: storeAnswer,
	});
}
