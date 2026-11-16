import { expect } from "bun:test";

import type {
	MemoriesPage,
	MemoryReviewReply,
} from "../../src/memories-page.ts";
import { serveHub } from "../insights/_support.ts";
import type { Answers } from "../support/factory.ts";

export const conflictingMemory = {
	id: "mem-conflict",
	repo: "acme/widget",
	kind: "lesson",
	state: "conflicting",
	text: "Routes must keep the /api prefix",
	author: "ana",
	run_id: "run-40",
	ticket: "acme/widget#40",
	role: null,
	paths: ["src/app.ts"],
	concepts: ["routing"],
	created_at: "2026-10-23T09:00:00Z",
};

export const verifiedMemory = {
	id: "mem-verified",
	repo: "acme/widget",
	kind: "precedent",
	state: "verified",
	text: "Run the tests with the seed printed by the slot script",
	author: "lev",
	run_id: "run-41",
	ticket: "acme/widget#41",
	role: null,
	paths: ["scripts/test-slot.sh"],
	concepts: ["tests"],
	created_at: "2026-10-22T08:00:00Z",
};

export const unverifiedMemory = {
	id: "mem-unverified",
	repo: "acme/widget",
	kind: "lesson",
	state: "unverified",
	text: "The graph layout needs the recorded tickets",
	author: "ana",
	run_id: null,
	ticket: null,
	role: null,
	paths: [],
	concepts: ["graph"],
	created_at: "2026-10-24T07:00:00Z",
};

export const review: MemoryReviewReply = {
	conflicting: [conflictingMemory],
	recent: [verifiedMemory, unverifiedMemory],
	evidence: [
		{
			memory_id: "mem-verified",
			kind: "voted_for",
			event: "vote lev",
			run_id: null,
			ticket: null,
			created_at: "2026-10-22T09:00:00Z",
		},
		{
			memory_id: "mem-verified",
			kind: "voted_against",
			event: "vote lev",
			run_id: null,
			ticket: null,
			created_at: "2026-10-22T09:05:00Z",
		},
		{
			memory_id: "mem-verified",
			kind: "voted_for",
			event: "vote ana",
			run_id: null,
			ticket: null,
			created_at: "2026-10-22T09:10:00Z",
		},
		{
			memory_id: "mem-conflict",
			kind: "cited",
			event: "run run-40 cited the memory",
			run_id: "run-40",
			ticket: "acme/widget#40",
			created_at: "2026-10-23T09:00:00Z",
		},
	],
};

export const serveAt = (answers: Answers) =>
	serveHub(answers, undefined, () => new Date("2026-11-16T00:00:00Z"));

export async function readJson<T>(base: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, base));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

export async function pageWhere(
	base: string,
	accept: (page: MemoriesPage) => boolean,
): Promise<MemoriesPage> {
	while (true) {
		const page = await readJson<MemoriesPage>(base, "/api/memories");
		if (accept(page)) {
			return page;
		}
		await Bun.sleep(20);
	}
}
