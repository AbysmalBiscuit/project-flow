import { expect, test } from "bun:test";
import type { NeedsYouItem } from "../src/domain.ts";
import { githubFetch, issue, type Sent, serve } from "./replies-github-fake.ts";
import { linearFake } from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

test("a display name still finds the GitHub row and quotes its ask", async () => {
	const sent: Sent[] = [];
	const headline = "This waits on Lev for the signing key.";
	const recorded = githubFetch(sent, {
		issues: [{ ...issue(7), comments: 1 }],
		comments: {
			7: [
				{
					id: 72,
					body: `Senior, ${headline}\n\n${ask("gh-board")}`,
					user: { login: "ada" },
					created_at: "2026-08-18T12:00:00.000Z",
				},
			],
		},
	});
	const app = await serve(
		recorded,
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	try {
		const listed = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(listed.find((item) => item.key === "acme/widget#7")).toMatchObject({
			project: "acme/widget",
			answered: false,
		});
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "github",
				project: "Widget board",
				key: "acme/widget#7",
				body: "Use the short name.",
			}),
		});
		expect(posted.status).toBe(201);
		expect(
			JSON.parse(
				sent.find(
					(item) =>
						item.method === "POST" && item.url.includes("/issues/7/comments"),
				)?.body ?? "{}",
			),
		).toEqual({
			body: `> ${headline}\n\nUse the short name.`,
		});
		const needs = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(needs.find((item) => item.key === "acme/widget#7")).toMatchObject({
			answered: true,
		});
	} finally {
		await app.stop();
	}
});

test("a GitHub project with a PM Bot posts an unnamed ask unchanged", async () => {
	const sent: Sent[] = [];
	const recorded = githubFetch(sent, {
		issues: [
			{
				...issue(7),
				comments: 1,
			},
		],
		comments: {
			7: [
				{
					id: 71,
					body: `Which name?\n\n${ask("gh-7")}`,
					user: { login: "ada" },
					created_at: "2026-08-18T12:00:00.000Z",
				},
			],
		},
	});
	const app = await serve(
		recorded,
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	try {
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "github",
				project: "acme/widget",
				key: "acme/widget#7",
				body: "Use the short name.",
			}),
		});
		expect(posted.status).toBe(201);
		const created = sent.find(
			(item) =>
				item.method === "POST" && item.url.includes("/issues/7/comments"),
		);
		expect(JSON.parse(created?.body ?? "{}")).toEqual({
			body: "Use the short name.",
		});
	} finally {
		await app.stop();
	}
});

test("a reply under another comment posts the typed text and leaves the ask open", async () => {
	const sent: string[] = [];
	const headline = "Which name?";
	const recorded = linearFake({
		project: linearProject,
		issues: [
			{
				id: "issue-pf-26",
				identifier: "PF-26",
				title: "Needs a name",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: {
					nodes: [
						{
							id: "comment-ask-26",
							body: `${headline}\n\n${ask("pf-26")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Ada" },
						},
						{
							id: "comment-other-26",
							body: "A note beside the ask.",
							createdAt: "2026-08-18T12:05:00.000Z",
							user: { name: "Ada" },
						},
					],
				},
			},
		],
		requests: sent,
	});
	const app = await serve(
		recorded,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
		}),
	);
	try {
		const nested = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "PF-26",
				parentId: "comment-other-26",
				body: "Use the short name.",
			}),
		});
		expect(nested.status).toBe(201);
		expect(
			JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
		).toMatchObject({
			variables: {
				input: {
					issueId: "PF-26",
					parentId: "comment-other-26",
					body: "Use the short name.",
				},
			},
		});
		const open = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(open.find((item) => item.key === "PF-26")).toMatchObject({
			headline,
			answered: false,
		});

		sent.length = 0;
		const underAsk = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "PF-26",
				parentId: "comment-ask-26",
				body: "Use the short name.",
			}),
		});
		expect(underAsk.status).toBe(201);
		const quoted = `> ${headline}\n\nUse the short name.`;
		expect(
			JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
		).toMatchObject({
			variables: {
				input: {
					parentId: "comment-ask-26",
					body: quoted,
				},
			},
		});
		const answered = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(answered.find((item) => item.key === "PF-26")).toMatchObject({
			headline,
			answered: true,
		});
	} finally {
		await app.stop();
	}
});

test("a marker-only ask posts the panel text unchanged", async () => {
	const sent: string[] = [];
	const recorded = linearFake({
		project: linearProject,
		issues: [
			{
				id: "issue-pf-15",
				identifier: "PF-15",
				title: "Marker only",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: {
					nodes: [
						{
							id: "comment-ask-15",
							body: ask("pf-15"),
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Ada" },
							reactions: [],
						},
					],
				},
			},
		],
		requests: sent,
	});
	const app = await serve(
		recorded,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
		}),
	);
	try {
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "PF-15",
				body: "No headline to quote.",
			}),
		});
		expect(posted.status).toBe(201);
		const created = sent.find((body) => body.includes("commentCreate"));
		expect(JSON.parse(created ?? "{}")).toMatchObject({
			variables: { input: { body: "No headline to quote." } },
		});
	} finally {
		await app.stop();
	}
});

test("a reply that quotes the old headline stays answered", async () => {
	const named = "This waits on Lev for the signing key.";
	const question = "Which key should the panel use?";
	const askBody = `Senior, ${named}\n${question}\n\n1. the current key\n2. a new key\n\n${ask("pf-40")}`;
	const recorded = linearFake({
		project: linearProject,
		issues: [
			{
				id: "issue-pf-40",
				identifier: "PF-40",
				title: "Needs a key",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: {
					nodes: [
						{
							id: "comment-ask-40",
							body: askBody,
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Ada" },
						},
						{
							id: "comment-quoted-40",
							body: `> ${named}\n\nUse the current key.`,
							createdAt: "2026-08-18T13:00:00.000Z",
							user: { name: "Lev" },
						},
					],
				},
			},
		],
	});
	const app = await serve(
		recorded,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			pmBot: { "widget-launch": false },
		}),
	);
	try {
		const listed = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(listed.find((item) => item.key === "PF-40")).toMatchObject({
			headline: named,
			question,
			answered: true,
		});
	} finally {
		await app.stop();
	}
});

test("picking an option posts a reply that names the pick", async () => {
	const sent: string[] = [];
	const question = "Which name should the gate use?";
	const pick = "the short name";
	const recorded = linearFake({
		project: linearProject,
		issues: [
			{
				id: "issue-pf-30",
				identifier: "PF-30",
				title: "Needs a name",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: {
					nodes: [
						{
							id: "comment-ask-30",
							body: `${question}\n\n1. ${pick}\n2. the long name\n\n${ask("pf-30")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Ada" },
						},
					],
				},
			},
		],
		requests: sent,
	});
	const app = await serve(
		recorded,
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			pmBot: { "widget-launch": false },
		}),
	);
	try {
		const before = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(before.find((item) => item.key === "PF-30")).toMatchObject({
			question,
			options: [
				{ number: 1, label: pick },
				{ number: 2, label: "the long name" },
			],
			answered: false,
		});
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "PF-30",
				option: 1,
			}),
		});
		expect(posted.status).toBe(201);
		const created = sent.find((body) => body.includes("commentCreate"));
		const input = (
			JSON.parse(created ?? "{}") as {
				variables?: { input?: { body?: string } };
			}
		).variables?.input?.body;
		expect(input).toContain("1. the short name");
		const after = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(after.find((item) => item.key === "PF-30")).toMatchObject({
			answered: true,
		});
	} finally {
		await app.stop();
	}
});
