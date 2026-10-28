import { expect, test } from "bun:test";

import type { Thread } from "../src/domain.ts";
import { githubFetch, issue, type Sent, serve } from "./replies-github-fake.ts";
import { linearFake } from "./support/linear.ts";
import { settledRead } from "./support/reads.ts";

const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

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
			new URL("/api/threads/github/acme%2Fwidget%237?project=%20%20", app.base),
		);
		const empty = await settledRead(
			new URL("/api/threads/github/acme%2Fwidget%237", app.base),
		);
		expect(blank.status).toBe(404);
		expect(empty.status).toBe(404);
		expect(((await blank.json()) as { missing?: boolean }).missing).toBe(true);
		expect(((await empty.json()) as { missing?: boolean }).missing).toBe(true);
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
		expect(thread.comments[0]?.html).not.toContain("workcell:ask");
	} finally {
		await app.stop();
	}
});
