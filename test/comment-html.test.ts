import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function comment(id: number, body: string): Record<string, unknown> {
	return {
		id,
		body,
		user: { login: "ada" },
		created_at: "2026-08-18T12:00:00.000Z",
		html_url: `https://github.com/acme/widget/issues/7#issuecomment-${id}`,
	};
}

function issue(number: number, comments = 1): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "Body",
		comments,
		labels: [],
		assignee: null,
	};
}

function githubFetch(options: {
	issues: Record<string, unknown>[];
	comments?: Record<number, Record<string, unknown>[]>;
}): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		if (url.startsWith("https://api.github.com/repos/acme/widget/issues?")) {
			return json(options.issues);
		}
		const oneIssue = url.match(/\/repos\/(acme\/widget)\/issues\/(\d+)$/);
		if (oneIssue !== null) {
			const number = Number(oneIssue[2]);
			const found = options.issues.find((item) => item.number === number);
			if (found === undefined) {
				return unrecorded(input);
			}
			return json({
				...found,
				html_url: `https://github.com/acme/widget/issues/${number}`,
			});
		}
		const comments = url.match(
			/\/repos\/acme\/widget\/issues\/(\d+)\/comments(?:\?([^#]*))?$/,
		);
		if (comments !== null) {
			const number = Number(comments[1]);
			return json(options.comments?.[number] ?? []);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/labels?") ||
			url.includes("/branches?")
		) {
			return json([]);
		}
		return unrecorded(input);
	};
}

async function serve(
	fetchImpl: Fetch,
	config: string,
): Promise<{ base: string; stop: () => Promise<void> }> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	await writeFile(join(root, "notes.txt"), "untracked harness file\n");
	let startChecks: (base: string) => void = () => {};
	const ready = new Promise<string>((resolve) => {
		startChecks = resolve;
	});
	const stopped = new Promise<void>((resolve) => {
		void ready.then(() => {
			stop = async () => {
				resolve();
				await cleanup();
				await rm(root, { recursive: true, force: true });
			};
		});
	});
	let stop: () => Promise<void> = async () => {};
	const running = run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: {
				GITHUB_TOKEN: "recorded-github-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath: join(root, "store.sqlite"),
			stdout: (line) => startChecks(line),
			stderr: (line) => {
				throw new Error(line);
			},
			waitForStop: stopped,
		}),
	);
	const base = await ready;
	return {
		base,
		stop: async () => {
			await stop();
			const result = await running;
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		},
	};
}

describe("comment html", () => {
	test("a thread renders markdown and drops raw HTML", async () => {
		const cases = [
			{
				id: 71,
				body: "# Title\n\n- one\n\n- [ ] open\n\n[spec](https://example.com/spec)\n\n`ticket.key`\n\n```\nconst key = 1;\n```\n\n> quoted\n\n| A | B |\n| --- | --- |\n| cell | value |",
			},
			{
				id: 72,
				body: '<script>window.__ran = true</script>\n\n<img src="x" onerror="window.__ran = true">\n\nSee [trap](javascript:window.__ran=true) here.',
			},
			{ id: 73, body: "" },
			{ id: 74, body: "   \n\n  " },
			{ id: 75, body: "keep    the    gaps" },
		];
		const recorded = githubFetch({
			issues: [issue(7, cases.length)],
			comments: { 7: cases.map((item) => comment(item.id, item.body)) },
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			const html = thread.comments.map((item) => item.html);
			expect(html[0]).toContain("<h1>");
			expect(html[0]).toContain("<ul>");
			expect(html[0]).toContain("<li>");
			expect(html[0]).toContain('type="checkbox"');
			expect(html[0]).toContain('href="https://example.com/spec"');
			expect(html[0]).toContain("<code>");
			expect(html[0]).toContain("<pre>");
			expect(html[0]).toContain("<blockquote>");
			expect(html[0]).toContain("<table>");
			expect(html[1]).not.toContain("<script");
			expect(html[1]).not.toContain("<img");
			expect(html[1]).not.toContain("javascript:");
			expect(html[1]).not.toMatch(/<[^>]*\sonerror=/);
			expect(html[1]).toContain("&lt;img");
			expect(html[1]).toContain("window.__ran = true");
			expect(html[1]).toContain("trap");
			expect(html[2]).toBe("");
			expect(html[3]?.trim()).toBe("");
			expect(html[4]).toContain("keep    the    gaps");
		} finally {
			await app.stop();
		}
	});

	test("a thread keeps only http, https and mailto links", async () => {
		const cases = [
			{ id: 81, body: "[x](httpfoo)" },
			{ id: 82, body: "[x](httpx:alert(1))" },
			{ id: 83, body: "see https://example.com/spec" },
			{ id: 84, body: "see <https://example.com/angle>" },
			{ id: 85, body: "![kept alt](https://example.com/a.png)" },
			{ id: 86, body: "![](https://example.com/b.png)" },
			{ id: 87, body: "before ![diagram](https://example.com/c.png) after" },
			{ id: 88, body: "one line\nnext line" },
			{ id: 89, body: "- [x] done\n- [ ] open" },
		];
		const recorded = githubFetch({
			issues: [issue(7, cases.length)],
			comments: { 7: cases.map((item) => comment(item.id, item.body)) },
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			const html = thread.comments.map((item) => item.html);
			expect(html[0]).toContain("x");
			expect(html[0]).not.toContain("<a");
			expect(html[0]).not.toContain("httpfoo");
			expect(html[1]).toContain("x");
			expect(html[1]).not.toContain("<a");
			expect(html[1]).not.toContain("httpx:");
			expect(html[2]).toContain('href="https://example.com/spec"');
			expect(html[3]).toContain("&lt;https://example.com/angle&gt;");
			expect(html[3]).not.toContain("<a");
			expect(html[4]).toContain("kept alt");
			expect(html[4]).not.toContain("<img");
			expect(html[4]).not.toContain("<a");
			expect(html[5]).not.toContain("<img");
			expect(html[5]).not.toContain("<a");
			expect(html[5]?.replace(/<[^>]+>/g, "").trim()).toBe("");
			expect(html[6]).toContain("before diagram after");
			expect(html[6]).not.toContain("<img");
			expect(html[6]).not.toContain("<a");
			expect(html[7]).toContain("one line\nnext line");
			expect(html[8]).toContain('checked=""');
			expect(html[8]).toContain('data-checked="">[x] </span>');
			expect(html[8]).not.toContain("[ ]");
		} finally {
			await app.stop();
		}
	});
});
