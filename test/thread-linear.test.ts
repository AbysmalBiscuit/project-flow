import { describe, expect, test } from "bun:test";
import type { Thread } from "../src/domain.ts";
import {
	githubFetch,
	issue,
	json,
	type Sent,
	serve,
} from "./replies-github-fake.ts";
import { linearFake, unrecorded } from "./support.ts";

const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

describe("thread reads", () => {
	test("a GitHub issue thread returns the tracker URL", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			comments: {
				7: [
					{
						id: 70,
						body: "Which name?",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/7#issuecomment-70",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=Widget%20board",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://github.com/acme/widget/issues/7");
			expect(sent.some((item) => item.url.includes("widget-board"))).toBe(
				false,
			);
			expect(
				sent.some(
					(item) =>
						item.url === "https://api.github.com/repos/acme/widget/issues/7",
				),
			).toBe(true);
			expect(thread.comments).toEqual([
				{
					id: "70",
					body: "Which name?",
					html: "<p>Which name?</p>\n",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/issues/7#issuecomment-70",
					parentId: null,
					kind: "comment",
					children: [],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a PR review thread nests the reply under its parent", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [{ ...issue(8, 0), pull_request: { url: "recorded" } }],
			reviewComments: {
				8: [
					{
						id: 44,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r44",
						in_reply_to_id: null,
					},
					{
						id: 45,
						body: "Renamed.",
						user: { login: "lev" },
						created_at: "2026-08-18T12:30:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r45",
						in_reply_to_id: 44,
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%238?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://github.com/acme/widget/issues/8");
			expect(thread.comments).toEqual([
				{
					id: "44",
					body: "Rename this.",
					html: "<p>Rename this.</p>\n",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/pull/8#discussion_r44",
					parentId: null,
					kind: "review",
					children: [
						{
							id: "45",
							body: "Renamed.",
							html: "<p>Renamed.</p>\n",
							author: "lev",
							createdAt: "2026-08-18T12:30:00.000Z",
							url: "https://github.com/acme/widget/pull/8#discussion_r45",
							parentId: "44",
							kind: "review",
							children: [],
						},
					],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a ticket panel shows the review threads of its linked PR", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(9, 1)],
			comments: {
				9: [
					{
						id: 90,
						body: "Issue note.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/9#issuecomment-90",
					},
				],
			},
			reviewComments: {
				12: [
					{
						id: 120,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:10:00.000Z",
						html_url: "https://github.com/acme/widget/pull/12#discussion_r120",
						in_reply_to_id: null,
					},
				],
			},
			graphql: (query) => {
				if (!query.includes("closedByPullRequestsReferences")) {
					return null;
				}
				return json({
					data: {
						repository: {
							issue: {
								closedByPullRequestsReferences: {
									nodes: [
										{
											number: 12,
											repository: { nameWithOwner: "acme/widget" },
										},
									],
								},
							},
						},
					},
				});
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%239?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments).toEqual([
				{
					id: "90",
					body: "Issue note.",
					html: "<p>Issue note.</p>\n",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/issues/9#issuecomment-90",
					parentId: null,
					kind: "comment",
					children: [],
				},
				{
					id: "120",
					body: "Rename this.",
					html: "<p>Rename this.</p>\n",
					author: "ada",
					createdAt: "2026-08-18T12:10:00.000Z",
					url: "https://github.com/acme/widget/pull/12#discussion_r120",
					parentId: null,
					kind: "review",
					children: [],
				},
			]);
			expect(
				sent.some(
					(item) =>
						item.url ===
						"https://api.github.com/repos/acme/widget/pulls/12/comments?per_page=100&page=1",
				),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a nested Linear thread returns the tracker URL", async () => {
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Open ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-parent",
								body: "Which name?",
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
							{
								id: "comment-child",
								body: "The short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								parent: { id: "comment-parent" },
								user: { displayName: "Lev" },
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
			}),
		);
		try {
			const response = await fetch(
				new URL("/api/threads/linear/PF-1?project=widget-launch", app.base),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://linear.app/issue/PF-1");
			expect(thread.comments).toEqual([
				{
					id: "comment-parent",
					body: "Which name?",
					html: "<p>Which name?</p>\n",
					author: "Ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://linear.app/issue/PF-1#comment-parent",
					parentId: null,
					kind: "comment",
					children: [
						{
							id: "comment-child",
							body: "The short name.",
							html: "<p>The short name.</p>\n",
							author: "Lev",
							createdAt: "2026-08-18T12:30:00.000Z",
							url: "https://linear.app/issue/PF-1#comment-child",
							parentId: "comment-parent",
							kind: "comment",
							children: [],
						},
					],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a Linear thread longer than 50 comments keeps the newest comment", async () => {
		const nodes = Array.from({ length: 51 }, (_, index) => ({
			id: `comment-${index}`,
			body: `Comment ${index}`,
			createdAt: `2026-08-18T12:${String(index).padStart(2, "0")}:00.000Z`,
			user: { name: "Ada" },
		}));
		const newest = nodes[50];
		if (newest === undefined) {
			throw new Error("missing newest comment");
		}
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-51",
					identifier: "PF-51",
					title: "Long thread",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: nodes.slice(0, 50),
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
				},
			],
		});
		const pages = new Map([
			[
				null,
				{
					nodes: nodes.slice(0, 50),
					pageInfo: { hasNextPage: true, endCursor: "page-2" },
				},
			],
			[
				"page-2",
				{
					nodes: [newest],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			],
		]);
		const app = await serve(
			async (input, init) => {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("IssueThread")) {
					const after =
						(
							JSON.parse(body) as {
								variables?: { after?: string | null };
							}
						).variables?.after ?? null;
					const page = pages.get(after);
					if (page === undefined) {
						return unrecorded(input);
					}
					return new Response(
						JSON.stringify({
							data: {
								issue: {
									identifier: "PF-51",
									title: "Long thread",
									url: "https://linear.app/issue/PF-51",
									comments: page,
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				return recorded(input, init);
			},
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(
				new URL("/api/threads/linear/PF-51?project=widget-launch", app.base),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments.at(-1)?.id).toBe("comment-50");
			expect(thread.comments).toHaveLength(51);
		} finally {
			await app.stop();
		}
	});
});
