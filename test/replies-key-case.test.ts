import { expect, test } from "bun:test";
import type { NeedsYouItem } from "../src/domain.ts";
import { serve } from "./replies-github-fake.ts";
import { linearFake } from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

const askedLinearIssue = (question: string) => ({
	id: "issue-pf-31",
	identifier: "PF-31",
	title: "Needs a name",
	description: "Body",
	state: { type: "unstarted" },
	updatedAt: "2026-08-18T12:00:00.000Z",
	labels: { nodes: [] },
	comments: {
		nodes: [
			{
				id: "comment-ask-31",
				body: `${question}\n\n1. the short name\n2. the long name\n\n${ask("pf-31")}`,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
			},
		],
	},
});

test("an option reply finds the ticket when the key case differs", async () => {
	const sent: string[] = [];
	const app = await serve(
		linearFake({
			project: linearProject,
			issues: [askedLinearIssue("Which name should the gate use?")],
			requests: sent,
		}),
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			pmBot: { "widget-launch": false },
		}),
	);
	try {
		await fetch(new URL("/api/needs-you", app.base));
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "pf-31",
				option: 1,
			}),
		});
		expect(posted.status).toBe(201);
		const created = sent.find((body) => body.includes("commentCreate"));
		expect(created).toContain("1. the short name");
	} finally {
		await app.stop();
	}
});

test("a free-text reply marks the ask answered when the key case differs", async () => {
	const app = await serve(
		linearFake({
			project: linearProject,
			issues: [askedLinearIssue("Which name should the gate use?")],
		}),
		JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			pmBot: { "widget-launch": false },
		}),
	);
	try {
		await fetch(new URL("/api/needs-you", app.base));
		const posted = await fetch(new URL("/api/replies", app.base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "linear",
				project: "widget-launch",
				key: "pf-31",
				body: "Use the short name.",
			}),
		});
		expect(posted.status).toBe(201);
		const needs = (await (
			await fetch(new URL("/api/needs-you", app.base))
		).json()) as NeedsYouItem[];
		expect(needs.find((item) => item.key === "PF-31")).toMatchObject({
			answered: true,
		});
	} finally {
		await app.stop();
	}
});
