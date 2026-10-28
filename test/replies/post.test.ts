import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import { eventsOf, quietReader } from "../events.ts";
import {
	githubFetch,
	issue,
	type Sent,
	serve,
} from "../replies-github-fake.ts";
import { urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import { ask, linearProject } from "./_support.ts";

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
