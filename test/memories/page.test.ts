import { expect, test } from "bun:test";

import type {
	MemoriesPage,
	MemoryHistory,
	MemoryHistoryAnswer,
	MemoryReview,
} from "../../src/memories-page.ts";
import { serveHub } from "../insights/_support.ts";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";

const conflictingMemory = {
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

const verifiedMemory = {
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

const unverifiedMemory = {
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

const review: MemoryReview = {
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

const historyAfterVote: MemoryHistory = {
	memory: unverifiedMemory,
	changes: [],
	evidence: [
		{
			memory_id: "mem-unverified",
			kind: "voted_for",
			event: "vote lev",
			run_id: null,
			ticket: null,
			created_at: "2026-10-25T10:00:00Z",
		},
	],
};

const conflictHistory: MemoryHistory = {
	memory: conflictingMemory,
	changes: [
		{
			memory_id: "mem-conflict",
			previous: "unverified",
			state: "verified",
			created_at: "2026-10-23T12:00:00Z",
		},
		{
			memory_id: "mem-conflict",
			previous: "verified",
			state: "conflicting",
			created_at: "2026-10-24T08:00:00Z",
		},
	],
	evidence: [
		{
			memory_id: "mem-conflict",
			kind: "cited",
			event: "run run-40 cited the memory",
			run_id: "run-40",
			ticket: "acme/widget#40",
			created_at: "2026-10-23T09:00:00Z",
		},
		{
			memory_id: "mem-conflict",
			kind: "voted_against",
			event: "vote ana",
			run_id: null,
			ticket: null,
			created_at: "2026-10-24T09:00:00Z",
		},
	],
};

const serveAt = (answers: Answers) =>
	serveHub(answers, undefined, () => new Date("2026-11-16T00:00:00Z"));

async function readJson<T>(base: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, base));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

async function pageWhere(
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

test("the recorded review gives the conflicting and the recent memories of a repo, with their votes", async () => {
	const app = await serveAt({
		...hub,
		"/repos/acme/widget/memories": review,
	});
	try {
		const page = await pageWhere(app.base, (found) => found.repos.length > 0);
		const [repo] = page.repos;
		expect(repo?.repo).toBe("acme/widget");
		expect(repo?.factory).toBe("work hub");
		expect(repo?.notServed).toBe(false);
		expect(repo?.conflicting).toMatchObject([
			{
				id: "mem-conflict",
				kind: "lesson",
				state: "conflicting",
				text: "Routes must keep the /api prefix",
				author: "ana",
				paths: ["src/app.ts"],
				concepts: ["routing"],
				votesFor: 0,
				votesAgainst: 0,
			},
		]);
		expect(repo?.recent.map((row) => row.id)).toEqual([
			"mem-verified",
			"mem-unverified",
		]);
		expect(repo?.recent.map((row) => [row.votesFor, row.votesAgainst])).toEqual(
			[
				[1, 1],
				[0, 0],
			],
		);
	} finally {
		await app.stop();
	}
});

test("a vote goes to the daemon and gives the history with the new evidence record", async () => {
	const requests: FactoryRequest[] = [];
	const answers: Answers = {
		...hub,
		"/repos/acme/widget/memories": review,
		"/repos/acme/widget/memories/mem-unverified/votes": (
			_url: URL,
			method: string,
		) => (method === "POST" ? historyAfterVote : null),
	};
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests),
		{ env: { GITHUB_TOKEN: "recorded-token" } },
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await fetch(
			new URL("/api/memories/acme/widget/mem-unverified/votes", app.base),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ stance: "for" }),
			},
		);
		expect(response.status).toBe(200);
		const answer = (await response.json()) as MemoryHistoryAnswer;
		expect(answer.evidence.at(-1)).toEqual({
			kind: "voted_for",
			event: "vote lev",
			runId: null,
			ticket: null,
			at: "2026-10-25T10:00:00Z",
		});
		expect(answer.memory?.votesFor).toBe(1);

		const posts = requests.filter((request) => request.method === "POST");
		expect(posts.map((request) => new URL(request.url).pathname)).toEqual([
			"/repos/acme/widget/memories/mem-unverified/votes",
		]);
		expect(JSON.parse(posts[0]?.body ?? "null")).toEqual({
			voter: "lev",
			stance: "for",
		});
	} finally {
		await app.stop();
	}
});

test("a vote that the factory refuses gives the reason of the factory", async () => {
	const requests: FactoryRequest[] = [];
	const answers: Answers = {
		...hub,
		"/repos/acme/widget/memories": review,
		"/repos/acme/widget/memories/mem-unverified/votes": (
			_url: URL,
			method: string,
		) =>
			method === "POST"
				? Response.json(
						{ error: "the repo of acme/widget does not opt in to memory" },
						{ status: 403 },
					)
				: null,
	};
	const app = await serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch({ [hubUrl]: answers }, requests),
		{ env: { GITHUB_TOKEN: "recorded-token" } },
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await fetch(
			new URL("/api/memories/acme/widget/mem-unverified/votes", app.base),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ stance: "against" }),
			},
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: "the repo of acme/widget does not opt in to memory",
		});
	} finally {
		await app.stop();
	}
});

test("the history of one memory gives its state changes and its evidence, oldest first", async () => {
	const app = await serveAt({
		...hub,
		"/repos/acme/widget/memories": review,
		"/repos/acme/widget/memories/mem-conflict": conflictHistory,
	});
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const answer = await readJson<MemoryHistoryAnswer>(
			app.base,
			"/api/memories/acme/widget/mem-conflict",
		);
		expect(answer.notServed).toBe(false);
		expect(answer.changes).toEqual([
			{
				previous: "unverified",
				state: "verified",
				at: "2026-10-23T12:00:00Z",
			},
			{
				previous: "verified",
				state: "conflicting",
				at: "2026-10-24T08:00:00Z",
			},
		]);
		expect(answer.evidence).toEqual([
			{
				kind: "cited",
				event: "run run-40 cited the memory",
				runId: "run-40",
				ticket: "acme/widget#40",
				at: "2026-10-23T09:00:00Z",
			},
			{
				kind: "voted_against",
				event: "vote ana",
				runId: null,
				ticket: null,
				at: "2026-10-24T09:00:00Z",
			},
		]);
	} finally {
		await app.stop();
	}
});

test("a factory with no memory route gets the not served note", async () => {
	const app = await serveAt(hub);
	try {
		const page = await pageWhere(app.base, (found) => found.repos.length > 0);
		const [repo] = page.repos;
		expect(repo?.notServed).toBe(true);
		expect(repo?.conflicting).toEqual([]);
		expect(repo?.recent).toEqual([]);

		const answer = await readJson<MemoryHistoryAnswer>(
			app.base,
			"/api/memories/acme/widget/mem-missing",
		);
		expect(answer.notServed).toBe(true);
		expect(answer.memory).toBeNull();
	} finally {
		await app.stop();
	}
});
