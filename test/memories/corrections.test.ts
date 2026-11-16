import { expect, test } from "bun:test";

import type {
	MemoryHistoryAnswer,
	MemoryHistoryReply,
} from "../../src/memories-page.ts";
import {
	type Answers,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	serve,
} from "../support/factory.ts";
import {
	conflictingMemory,
	pageWhere,
	review,
	unverifiedMemory,
	verifiedMemory,
} from "./_support.ts";

const newHistory: MemoryHistoryReply = {
	memory: {
		...conflictingMemory,
		id: "mem-new",
		state: "unverified",
		text: "Only the JSON routes keep the /api prefix",
		author: "lev",
		run_id: null,
		ticket: null,
		supersedes: "mem-conflict",
		basis: "src/app.ts serves /events without the prefix",
		created_at: "2026-11-15T10:00:00Z",
	},
	changes: [],
	evidence: [],
};

async function post(
	base: string,
	path: string,
	body: unknown,
): Promise<Response> {
	return fetch(new URL(path, base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function serveWith(answers: Answers, requests: FactoryRequest[]) {
	return serve(
		[],
		{ factories: [{ name: "work hub", url: hubUrl }] },
		factoryFetch(
			{
				[hubUrl]: { ...hub, "/repos/acme/widget/memories": review, ...answers },
			},
			requests,
		),
		{ env: { GITHUB_TOKEN: "recorded-token" } },
	);
}

function daemonPosts(
	requests: FactoryRequest[],
): { path: string; body: unknown }[] {
	return requests
		.filter((request) => request.method === "POST")
		.map((request) => ({
			path: new URL(request.url).pathname,
			body: JSON.parse(request.body ?? "null"),
		}));
}

test("a supersede sends its text and evidence, and gives the history of the new memory that supersedes the old one", async () => {
	const requests: FactoryRequest[] = [];
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/mem-conflict/supersede": Response.json(
				newHistory,
				{ status: 201 },
			),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await post(
			app.base,
			"/api/memories/acme/widget/mem-conflict/supersede",
			{
				text: "Only the JSON routes keep the /api prefix",
				evidence: "src/app.ts serves /events without the prefix",
			},
		);
		expect(response.status).toBe(200);
		const answer = (await response.json()) as MemoryHistoryAnswer;
		expect(answer.memory).toMatchObject({
			id: "mem-new",
			state: "unverified",
			supersedes: "mem-conflict",
			basis: "src/app.ts serves /events without the prefix",
		});
		expect(daemonPosts(requests)).toEqual([
			{
				path: "/repos/acme/widget/memories/mem-conflict/supersede",
				body: {
					text: "Only the JSON routes keep the /api prefix",
					evidence: "src/app.ts serves /events without the prefix",
					author: "lev",
				},
			},
		]);
	} finally {
		await app.stop();
	}
});

test("an undo of a supersede gives the history of the old memory in its earlier state", async () => {
	const requests: FactoryRequest[] = [];
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/mem-new/undo": Response.json({
				memory: { ...conflictingMemory, state: "verified" },
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
						created_at: "2026-11-15T10:00:00Z",
					},
					{
						memory_id: "mem-conflict",
						previous: "conflicting",
						state: "verified",
						created_at: "2026-11-15T11:00:00Z",
					},
				],
				evidence: [],
			}),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await post(
			app.base,
			"/api/memories/acme/widget/mem-new/undo",
			{},
		);
		expect(response.status).toBe(200);
		const answer = (await response.json()) as MemoryHistoryAnswer;
		expect(answer.memory?.id).toBe("mem-conflict");
		expect(answer.memory?.state).toBe("verified");
		expect(answer.changes.at(-1)).toEqual({
			previous: "conflicting",
			state: "verified",
			at: "2026-11-15T11:00:00Z",
		});
		expect(daemonPosts(requests)).toEqual([
			{
				path: "/repos/acme/widget/memories/mem-new/undo",
				body: { person: "lev" },
			},
		]);
	} finally {
		await app.stop();
	}
});

test("a suppress and then a restore each give the new history of the memory", async () => {
	const requests: FactoryRequest[] = [];
	const suppressed = {
		memory: { ...unverifiedMemory, state: "suppressed" },
		changes: [
			{
				memory_id: "mem-unverified",
				previous: "unverified",
				state: "suppressed",
				created_at: "2026-11-15T12:00:00Z",
			},
		],
		evidence: [],
	};
	const restored = {
		memory: { ...unverifiedMemory, state: "unverified" },
		changes: [
			...suppressed.changes,
			{
				memory_id: "mem-unverified",
				previous: "suppressed",
				state: "unverified",
				created_at: "2026-11-15T13:00:00Z",
			},
		],
		evidence: [],
	};
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/mem-unverified/suppress":
				Response.json(suppressed),
			"/repos/acme/widget/memories/mem-unverified/restore":
				Response.json(restored),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const suppress = await post(
			app.base,
			"/api/memories/acme/widget/mem-unverified/suppress",
			{},
		);
		expect(suppress.status).toBe(200);
		const suppressAnswer = (await suppress.json()) as MemoryHistoryAnswer;
		expect(suppressAnswer.memory?.state).toBe("suppressed");

		const restore = await post(
			app.base,
			"/api/memories/acme/widget/mem-unverified/restore",
			{},
		);
		expect(restore.status).toBe(200);
		const restoreAnswer = (await restore.json()) as MemoryHistoryAnswer;
		expect(restoreAnswer.memory?.state).toBe("unverified");
		expect(restoreAnswer.changes).toHaveLength(2);

		expect(daemonPosts(requests)).toEqual([
			{
				path: "/repos/acme/widget/memories/mem-unverified/suppress",
				body: { person: "lev" },
			},
			{
				path: "/repos/acme/widget/memories/mem-unverified/restore",
				body: {},
			},
		]);
	} finally {
		await app.stop();
	}
});

test("a merge of two memories gives the history of the merged memory", async () => {
	const requests: FactoryRequest[] = [];
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/merges": Response.json(
				{
					memory: {
						...verifiedMemory,
						id: "mem-merged",
						text: "Run the tests with the printed seed",
						author: "lev",
						run_id: null,
						ticket: null,
						duplicates: ["mem-verified", "mem-unverified"],
						created_at: "2026-11-15T14:00:00Z",
					},
					changes: [],
					evidence: [],
				},
				{ status: 201 },
			),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await post(app.base, "/api/memories/acme/widget/merges", {
			memories: ["mem-verified", "mem-unverified"],
			text: "Run the tests with the printed seed",
		});
		expect(response.status).toBe(200);
		const answer = (await response.json()) as MemoryHistoryAnswer;
		expect(answer.memory).toMatchObject({
			id: "mem-merged",
			state: "verified",
			duplicates: ["mem-verified", "mem-unverified"],
		});
		expect(daemonPosts(requests)).toEqual([
			{
				path: "/repos/acme/widget/memories/merges",
				body: {
					text: "Run the tests with the printed seed",
					author: "lev",
					memories: ["mem-verified", "mem-unverified"],
				},
			},
		]);
	} finally {
		await app.stop();
	}
});

test("a correction that the daemon refuses gives the reason of the daemon", async () => {
	const requests: FactoryRequest[] = [];
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/mem-unverified/suppress": Response.json(
				{
					error:
						"memory mem-unverified is superseded, so a suppress does not apply",
				},
				{ status: 409 },
			),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const response = await post(
			app.base,
			"/api/memories/acme/widget/mem-unverified/suppress",
			{},
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error:
				"memory mem-unverified is superseded, so a suppress does not apply",
		});
	} finally {
		await app.stop();
	}
});

test("a daemon 404 or 502 that names a reason gives the reason of the daemon", async () => {
	const requests: FactoryRequest[] = [];
	const app = await serveWith(
		{
			"/repos/acme/widget/memories/mem-unverified/restore": Response.json(
				{ error: "acme/widget holds no suppressed memory mem-unverified" },
				{ status: 404 },
			),
			"/repos/acme/widget/memories/mem-conflict/supersede": Response.json(
				{ error: "the central store did not take memory mem-new" },
				{ status: 502 },
			),
		},
		requests,
	);
	try {
		await pageWhere(app.base, (found) => found.repos.length > 0);
		const restore = await post(
			app.base,
			"/api/memories/acme/widget/mem-unverified/restore",
			{},
		);
		expect(restore.status).toBe(422);
		expect(await restore.json()).toEqual({
			error: "acme/widget holds no suppressed memory mem-unverified",
		});

		const supersede = await post(
			app.base,
			"/api/memories/acme/widget/mem-conflict/supersede",
			{
				text: "Only the JSON routes keep the /api prefix",
				evidence: "src/app.ts",
			},
		);
		expect(supersede.status).toBe(422);
		expect(await supersede.json()).toEqual({
			error: "the central store did not take memory mem-new",
		});
	} finally {
		await app.stop();
	}
});
