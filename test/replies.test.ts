import { describe, expect, test } from "bun:test";

import type { NeedsYouItem, Thread } from "../src/domain.ts";
import { eventsOf, quietReader } from "./events.ts";
import {
	githubFetch,
	issue,
	json,
	type Sent,
	serve,
	unrecorded,
	urlOf,
} from "./replies-github-fake.ts";
import { linearFake } from "./support/linear.ts";
import { settledRead } from "./support/reads.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;
const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

describe("replies", () => {
	test("a GitHub issue reply posts a plain new comment", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const stream = await fetch(new URL("/api/events", app.base), {
				headers: { accept: "text/event-stream" },
			});
			const reader = stream.body?.getReader();
			if (reader === undefined) {
				throw new Error("event stream has no body");
			}
			const quiet = quietReader(reader);
			expect(await quiet.untilIdle()).toContain(": open");
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "Use the short name.",
				}),
			});
			expect(response.status).toBe(201);
			const created = (await response.json()) as {
				body: string;
				url: string;
			};
			expect(created.body).toBe("Use the short name.");
			const published = eventsOf(await quiet.untilIdle());
			await reader.cancel();
			expect(published.map((event) => event.event)).toEqual(["overview"]);
			expect(created.url).toBe(
				"https://github.com/acme/widget/issues/7#issuecomment-900",
			);
			const posted = sent.find(
				(item) =>
					item.method === "POST" &&
					item.url ===
						"https://api.github.com/repos/acme/widget/issues/7/comments",
			);
			expect(posted?.body).toBe(
				JSON.stringify({ body: "Use the short name." }),
			);
		} finally {
			await app.stop();
		}
	});

	test("a PR review reply posts into that review thread", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(8, 0)],
			reviewComments: {
				8: [
					{
						id: 44,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r44",
						path: "src/app.ts",
						in_reply_to_id: null,
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#8",
					parentId: "44",
					kind: "review",
					body: "Renamed.",
				}),
			});
			expect(response.status).toBe(201);
			const posted = sent.find(
				(item) =>
					item.method === "POST" &&
					item.url ===
						"https://api.github.com/repos/acme/widget/pulls/8/comments",
			);
			expect(JSON.parse(posted?.body ?? "{}")).toEqual({
				body: "Renamed.",
				in_reply_to: 44,
			});
		} finally {
			await app.stop();
		}
	});

	test("a Linear reply posts into that comment thread", async () => {
		const sent: string[] = [];
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
								body: `Which name?\n\n${ask("pf-1")}`,
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
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-1",
					parentId: "comment-parent",
					body: "Use the short name.",
				}),
			});
			expect(response.status).toBe(201);
			const created = (await response.json()) as { body: string };
			expect(created.body).toBe("> Which name?\n\nUse the short name.");
			const posted = sent.find((body) => body.includes("commentCreate"));
			expect(posted).toBeDefined();
			const parsed = JSON.parse(posted ?? "{}") as {
				variables?: {
					input?: { issueId?: string; parentId?: string; body?: string };
				};
			};
			expect(parsed.variables?.input).toEqual({
				issueId: "PF-1",
				parentId: "comment-parent",
				body: "> Which name?\n\nUse the short name.",
			});
		} finally {
			await app.stop();
		}
	});

	test("a missing ticket sends no comment and a spaced body posts", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const missing = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#404",
					body: "Nowhere.",
				}),
			});
			expect(missing.status).toBe(404);
			const spaced = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "  Use the short name.  ",
				}),
			});
			expect(spaced.status).toBe(201);
			const posted = sent.find(
				(item) =>
					item.method === "POST" && item.url.includes("/issues/7/comments"),
			);
			expect(JSON.parse(posted?.body ?? "{}")).toEqual({
				body: "Use the short name.",
			});
		} finally {
			await app.stop();
		}
	});

	test("a blank reply sends no tracker request", async () => {
		const sent: string[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-blank",
					identifier: "PF-BLANK",
					title: "Blank",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
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
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-BLANK",
					body: "   ",
				}),
			});
			expect(response.status).toBe(400);
			expect(sent.some((body) => body.includes("commentCreate"))).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a failed reply returns the tracker error", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			failReply: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "Keep this text.",
				}),
			});
			expect(response.status).toBe(422);
			const failed = (await response.json()) as { error: string };
			expect(failed.error).toContain("HTTP 422");
			expect(failed.error).not.toContain("Keep this text.");
		} finally {
			await app.stop();
		}
	});

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

	test("a thread longer than 100 comments keeps the newest comment", async () => {
		const sent: Sent[] = [];
		const comments = Array.from({ length: 101 }, (_, index) => ({
			id: index + 1,
			body: `Note ${index + 1}`,
			user: { login: "ada" },
			created_at: "2026-08-18T12:00:00.000Z",
			html_url: `https://github.com/acme/widget/issues/7#issuecomment-${index + 1}`,
		}));
		const recorded = githubFetch(sent, {
			issues: [issue(7, 101)],
			comments: { 7: comments },
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments).toHaveLength(101);
			expect(thread.comments.at(-1)?.body).toBe("Note 101");
			expect(
				sent.some((item) =>
					item.url.includes("/issues/7/comments?per_page=100&page=2"),
				),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("an unread PR thread is missing, not a tracker error", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%2340?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(404);
			const failed = (await response.json()) as {
				error?: string;
				missing?: boolean;
			};
			expect(failed.error).toBeUndefined();
			expect(failed.missing).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a tracker failure stays an error, not a missing thread", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			failThread: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(502);
			const failed = (await response.json()) as {
				error?: string;
				missing?: boolean;
			};
			expect(failed.missing).toBeUndefined();
			expect(failed.error).toBe("GitHub fetch thread failed (HTTP 502)");
			expect(sent.some((item) => item.url.endsWith("/issues/7"))).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a blank project marks the thread missing", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const blank = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=%20%20",
					app.base,
				),
			);
			const empty = await settledRead(
				new URL("/api/threads/github/acme%2Fwidget%237", app.base),
			);
			expect(blank.status).toBe(404);
			expect(empty.status).toBe(404);
			expect(((await blank.json()) as { missing?: boolean }).missing).toBe(
				true,
			);
			expect(((await empty.json()) as { missing?: boolean }).missing).toBe(
				true,
			);
			expect(sent.some((item) => item.url.includes("/issues/7"))).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a missing Linear issue marks the thread missing", async () => {
		const recorded = linearFake({
			project: linearProject,
			issues: [],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await settledRead(
				new URL("/api/threads/linear/PF-404?project=widget-launch", app.base),
			);
			expect(response.status).toBe(404);
			const failed = (await response.json()) as { missing?: boolean };
			expect(failed.missing).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a thread hides the workcell marker from the rendered body", async () => {
		const recorded = githubFetch([], {
			issues: [issue(7)],
			comments: {
				7: [
					{
						id: 71,
						body: "Which name?\n\n<!-- workcell:ask 7-1 -->",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/7#issuecomment-71",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments[0]?.body).toBe("Which name?");
			expect(thread.comments[0]?.body).not.toContain("workcell:ask");
		} finally {
			await app.stop();
		}
	});

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
			const response = await settledRead(
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
			const response = await settledRead(
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
			const response = await settledRead(
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
			const response = await settledRead(
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
			const response = await settledRead(
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

	test("a thread read whose tracker calls never answer returns an error", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			hangThread: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
			{ threadReadLimitMs: 200 },
		);
		try {
			const started = Date.now();
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			const elapsed = Date.now() - started;
			expect(response.status).toBe(504);
			const failed = (await response.json()) as {
				error?: string;
				missing?: boolean;
			};
			expect(failed.missing).toBeUndefined();
			expect(failed.error).toBe("thread read timed out");
			expect(elapsed).toBeLessThan(2_000);
			expect(sent.some((item) => item.url.endsWith("/issues/7"))).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a blank ticket key returns an error without a tracker call", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL("/api/threads/github/%20%20?project=acme%2Fwidget", app.base),
			);
			expect(response.status).toBe(404);
			expect(((await response.json()) as { missing?: boolean }).missing).toBe(
				true,
			);
			expect(sent.some((item) => item.url.includes("/issues/"))).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a missing issue returns missing while the comment page is in flight", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(8)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%2399?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(404);
			expect(((await response.json()) as { missing?: boolean }).missing).toBe(
				true,
			);
		} finally {
			await app.stop();
		}
	});

	test("a failed tracker call still returns an error inside the time limit", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			failThread: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
			{ threadReadLimitMs: 200 },
		);
		try {
			const started = Date.now();
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(502);
			expect(Date.now() - started).toBeLessThan(2_000);
			expect(((await response.json()) as { error?: string }).error).toBe(
				"GitHub fetch thread failed (HTTP 502)",
			);
		} finally {
			await app.stop();
		}
	});

	test("a second thread read times out again when the tracker still never answers", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			hangThread: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
			{ threadReadLimitMs: 200 },
		);
		try {
			const path = new URL(
				"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
				app.base,
			);
			const first = await settledRead(path);
			const second = await fetch(path);
			expect(first.status).toBe(504);
			expect(second.status).toBe(504);
			expect(((await second.json()) as { error?: string }).error).toBe(
				"thread read timed out",
			);
		} finally {
			await app.stop();
		}
	});

	test("a GitHub thread read starts the comment page and the linked-PR lookup together", async () => {
		const sent: Sent[] = [];
		const open: { url: string; release: () => void }[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			holdUntilPeer: (url, release) => {
				open.push({ url, release });
				const comments = open.some((item) =>
					item.url.includes("/issues/7/comments"),
				);
				const linkedBody = sent.some(
					(item) =>
						item.url === "https://api.github.com/graphql" &&
						item.body.includes("LinkedPulls"),
				);
				if (
					comments &&
					open.some((item) => item.url === "https://api.github.com/graphql") &&
					linkedBody
				) {
					for (const item of open) {
						item.release();
					}
					open.length = 0;
				}
			},
			graphql: (query) => {
				if (!query.includes("LinkedPulls")) {
					return null;
				}
				return json({
					data: {
						repository: {
							issue: {
								closedByPullRequestsReferences: {
									nodes: [
										{
											number: 40,
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
			const response = await settledRead(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.title).toBe("Ticket 7");
			const commentAt = sent.findIndex((item) =>
				item.url.includes("/issues/7/comments"),
			);
			const linkedAt = sent.findIndex(
				(item) =>
					item.url === "https://api.github.com/graphql" &&
					item.body.includes("LinkedPulls"),
			);
			const reviewAt = sent.findIndex((item) =>
				item.url.includes("/pulls/40/comments"),
			);
			expect(commentAt).toBeGreaterThanOrEqual(0);
			expect(linkedAt).toBeGreaterThanOrEqual(0);
			const between = sent
				.slice(Math.min(commentAt, linkedAt) + 1, Math.max(commentAt, linkedAt))
				.filter((item) => !item.url.endsWith("/issues/7"));
			expect(between).toEqual([]);
			expect(reviewAt).toBeGreaterThan(Math.max(commentAt, linkedAt));
		} finally {
			await app.stop();
		}
	});

	test("a Linear reply error returns 502 and the tracker message", async () => {
		const recorded = linearFake({
			project: linearProject,
			fail: "reply",
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Open ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
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
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-1",
					body: "Keep this text.",
				}),
			});
			expect(response.status).toBe(502);
			const failed = (await response.json()) as { error: string };
			expect(failed.error).toBe("Linear reply failed: Issue not found");
			expect(failed.error).not.toContain("Keep this text.");
			expect(failed.error).not.toContain("Zod");
		} finally {
			await app.stop();
		}
	});

	test("a disabled merge or label action sends no tracker request", async () => {
		const trackerHosts = ["api.linear.app", "api.github.com"];
		const writes = ["POST", "PUT", "PATCH", "DELETE"];
		const calls: { method: string; host: string }[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-31",
					identifier: "PF-31",
					title: "Ready",
					description: "Body",
					state: { type: "started" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [{ name: "needs-human" }] },
					assignee: { id: "viewer-ada", name: "Ada" },
					comments: { nodes: [] },
				},
			],
		});
		const app = await serve(
			async (input, init) => {
				const method =
					init?.method ?? (input instanceof Request ? input.method : "GET");
				calls.push({ method, host: new URL(urlOf(input)).host });
				return recorded(input, init);
			},
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				needsYouLabels: ["needs-human"],
			}),
		);
		try {
			const listed = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(listed.find((item) => item.key === "PF-31")).toMatchObject({
				reason: "label",
			});
			const before = calls.length;
			for (const action of ["merge", "remove-label"]) {
				await fetch(new URL("/api/replies", app.base), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						tracker: "linear",
						project: "widget-launch",
						key: "PF-31",
						action,
					}),
				});
			}
			const write = calls
				.slice(before)
				.find(
					(call) =>
						writes.includes(call.method) && trackerHosts.includes(call.host),
				);
			expect(write).toBeUndefined();
		} finally {
			await app.stop();
		}
	});
});
