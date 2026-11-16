import { z } from "zod";

export const memoryStance = z.enum(["for", "against"]);

/** One memory of the central store, as the daemon memory routes give it. */
export const storedMemory = z.object({
	id: z.string(),
	repo: z.string(),
	kind: z.string(),
	state: z.string(),
	text: z.string(),
	author: z.string(),
	run_id: z.string().nullable(),
	ticket: z.string().nullable(),
	paths: z.array(z.string()),
	concepts: z.array(z.string()),
	created_at: z.string(),
	supersedes: z.string().nullable().default(null),
	basis: z.string().nullable().default(null),
	duplicates: z.array(z.string()).default([]),
});

/** One evidence record of a memory: an event of a run, or the vote of a person. */
export const memoryEvidence = z.object({
	memory_id: z.string(),
	kind: z.string(),
	event: z.string(),
	run_id: z.string().nullable(),
	ticket: z.string().nullable(),
	created_at: z.string(),
});

/** One state change of a memory. */
export const memoryStateChange = z.object({
	memory_id: z.string(),
	previous: z.string(),
	state: z.string(),
	created_at: z.string(),
});

/** `GET /repos/{owner}/{name}/memories`: the conflicting and the newest memories, with their evidence oldest first. */
export const memoryReview = z.object({
	conflicting: z.array(storedMemory),
	recent: z.array(storedMemory),
	evidence: z.array(memoryEvidence),
});

/** `GET /repos/{owner}/{name}/memories/{id}`: one memory, its state changes and its evidence, oldest first. */
export const memoryHistory = z.object({
	memory: storedMemory,
	changes: z.array(memoryStateChange),
	evidence: z.array(memoryEvidence),
});

/** The body of `POST /api/memories/:owner/:name/:id/votes`. */
export const memoryStanceBody = z.object({ stance: memoryStance });

/** The corrections of one memory, each a route of the daemon under `/repos/{owner}/{name}/memories/{id}`. */
export const memoryCorrection = z.enum([
	"supersede",
	"undo",
	"suppress",
	"restore",
]);

/** The body of a supersede: the new text, and the evidence that the claim of the old memory is wrong. */
export const supersedeBody = z.object({
	text: z.string().trim().min(1),
	evidence: z.string().trim().min(1),
});

/** The body of `POST /api/memories/:owner/:name/merges`: the duplicate memories, and the one text that replaces them. */
export const mergeBody = z.object({
	memories: z.array(z.string().min(1)).min(2),
	text: z.string().trim().min(1),
});

export type MemoryStance = z.infer<typeof memoryStance>;
export type MemoryReview = z.infer<typeof memoryReview>;
export type MemoryHistory = z.infer<typeof memoryHistory>;
export type MemoryCorrection = z.infer<typeof memoryCorrection>;
export type SupersedeBody = z.infer<typeof supersedeBody>;
export type MergeBody = z.infer<typeof mergeBody>;

/** A review as the daemon sends it, before the defaults of the schema apply. */
export type MemoryReviewReply = z.input<typeof memoryReview>;

/** A history as the daemon sends it, before the defaults of the schema apply. */
export type MemoryHistoryReply = z.input<typeof memoryHistory>;

/** A correction of one memory, as the factory reader sends it. Only a supersede has a body. */
export type MemoryCorrectionRequest =
	| ({ correction: "supersede" } & SupersedeBody)
	| { correction: Exclude<MemoryCorrection, "supersede"> };

/** A vote or a correction: the history that the factory answers, the reason of a refusal, "not served" on a 404 that names no reason, or null when the factory did not answer. */
export type MemoryWriteResult =
	MemoryHistory | "not served" | { refused: string } | null;

/** A memory as the Memories tab shows it. */
export type MemoryRow = {
	id: string;
	kind: string;
	state: string;
	text: string;
	author: string;
	paths: string[];
	concepts: string[];
	createdAt: string;
	/** The memory that this memory supersedes. */
	supersedes: string | null;
	/** The evidence that the author of a supersede gave. */
	basis: string | null;
	/** The memories that a merge replaced with this memory. */
	duplicates: string[];
	/** The voters whose newest vote is for the memory. */
	votesFor: number;
	/** The voters whose newest vote is against the memory. */
	votesAgainst: number;
};

export type MemoryRepo = {
	/** The repo slug, `owner/name`. */
	repo: string;
	/** The name of the factory that the repo's memories come from. */
	factory: string;
	conflicting: MemoryRow[];
	recent: MemoryRow[];
	/** True when the factory has no memory route, or no central store holds the repo. */
	notServed: boolean;
	/** True when the factory did not answer the read. */
	unreachable: boolean;
};

/** `GET /api/memories`: each repo that a factory run names. */
export type MemoriesPage = { repos: MemoryRepo[] };

export type MemoryStateStep = { previous: string; state: string; at: string };

export type MemoryEvidenceRow = {
	kind: string;
	event: string;
	runId: string | null;
	ticket: string | null;
	at: string;
};

/** `GET /api/memories/:owner/:name/:id`, and the answer of a vote. */
export type MemoryHistoryAnswer = {
	repo: string;
	memory: MemoryRow | null;
	changes: MemoryStateStep[];
	evidence: MemoryEvidenceRow[];
	notServed: boolean;
};

const voteKinds: Record<string, "for" | "against"> = {
	voted_for: "for",
	voted_against: "against",
};

/** The newest vote of each voter counts. `evidence` comes oldest first. */
function votesOf(
	evidence: readonly z.infer<typeof memoryEvidence>[],
	memoryId: string,
): { votesFor: number; votesAgainst: number } {
	const newest = new Map<string, "for" | "against">();
	for (const record of evidence) {
		const stance = voteKinds[record.kind];
		if (record.memory_id === memoryId && stance !== undefined) {
			newest.set(record.event, stance);
		}
	}
	const stances = [...newest.values()];
	return {
		votesFor: stances.filter((stance) => stance === "for").length,
		votesAgainst: stances.filter((stance) => stance === "against").length,
	};
}

export function memoryRow(
	memory: z.infer<typeof storedMemory>,
	evidence: readonly z.infer<typeof memoryEvidence>[],
): MemoryRow {
	return {
		id: memory.id,
		kind: memory.kind,
		state: memory.state,
		text: memory.text,
		author: memory.author,
		paths: memory.paths,
		concepts: memory.concepts,
		createdAt: memory.created_at,
		supersedes: memory.supersedes,
		basis: memory.basis,
		duplicates: memory.duplicates,
		...votesOf(evidence, memory.id),
	};
}

export function historyAnswer(
	repo: string,
	history: MemoryHistory | null,
	notServed: boolean,
): MemoryHistoryAnswer {
	return {
		repo,
		memory:
			history === null ? null : memoryRow(history.memory, history.evidence),
		changes:
			history?.changes.map((change) => ({
				previous: change.previous,
				state: change.state,
				at: change.created_at,
			})) ?? [],
		evidence:
			history?.evidence.map((record) => ({
				kind: record.kind,
				event: record.event,
				runId: record.run_id,
				ticket: record.ticket,
				at: record.created_at,
			})) ?? [],
		notServed,
	};
}
