import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import { serve } from "../replies-github-fake.ts";
import { linearFake } from "../support/linear.ts";
import { ask, linearProject } from "./_support.ts";

describe("replies", () => {
	test("a posted reply marks the ask answered until an agent reacts", async () => {
		const sent: string[] = [];
		const question = "Which name?";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-11",
					identifier: "PF-11",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-11",
								body: `${question}\n\n${ask("pf-11")}`,
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
			}),
		);
		try {
			const before = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(before.find((item) => item.key === "PF-11")).toMatchObject({
				answered: false,
				acknowledged: false,
			});
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-11",
					parentId: "comment-ask-11",
					body: "Reply: the short name.",
				}),
			});
			expect(posted.status).toBe(201);
			const after = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(after.find((item) => item.key === "PF-11")).toMatchObject({
				answered: true,
				acknowledged: false,
			});
		} finally {
			await app.stop();
		}
	});

	test("a reply after the latest ask is answered, and a reaction acknowledges it", async () => {
		const sent: string[] = [];
		const question = "Which name?";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-9",
					identifier: "PF-9",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask",
								body: `${question}\n\n${ask("pf-9")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Lev" },
							},
							{
								id: "comment-reply",
								body: "Reply: the short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								user: { name: "Lev" },
								reactions: [{ id: "reaction-1" }],
							},
						],
					},
				},
				{
					id: "issue-pf-10",
					identifier: "PF-10",
					title: "Answered only",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-10",
								body: `${ask("pf-10")}\n${question}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Lev" },
							},
							{
								id: "comment-reply-10",
								body: "Reply: the short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								user: { name: "Lev" },
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
			const response = await fetch(new URL("/api/needs-you", app.base));
			expect(response.status).toBe(200);
			const items = (await response.json()) as NeedsYouItem[];
			expect(items.find((item) => item.key === "PF-9")).toMatchObject({
				answered: true,
				acknowledged: true,
			});
			expect(items.find((item) => item.key === "PF-10")).toMatchObject({
				answered: true,
				acknowledged: false,
			});
		} finally {
			await app.stop();
		}
	});
});
