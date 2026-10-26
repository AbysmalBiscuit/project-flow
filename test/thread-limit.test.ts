import { describe, expect, test } from "bun:test";

import type { Thread } from "../src/domain.ts";
import {
	githubFetch,
	issue,
	json,
	type Sent,
	serve,
} from "./replies-github-fake.ts";
import { settledRead } from "./support.ts";

describe("thread reads", () => {
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
});
