import { describe, expect, test } from "bun:test";

import {
	githubFetch,
	issue,
	type Sent,
	serve,
} from "../replies-github-fake.ts";
import { linearFake } from "../support/linear.ts";
import { settledRead } from "../support/reads.ts";
import { linearProject } from "./_support.ts";

describe("replies", () => {
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
});
