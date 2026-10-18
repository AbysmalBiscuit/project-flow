import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";

const repo = "acme/widget";

function ticket(
	number: number,
	state: "open" | "closed",
	stateReason: string | null,
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: stateReason,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

function pullRequest(number: number): Record<string, unknown> {
	return {
		...ticket(number, "closed", "completed"),
		pull_request: {
			url: `https://api.github.com/repos/${repo}/pulls/${number}`,
		},
	};
}

function page(items: Record<string, unknown>[], next: string | null): Response {
	const headers = new Headers({ "content-type": "application/json" });
	if (next !== null) {
		headers.set("link", `<${next}>; rel="next"`);
	}
	return new Response(JSON.stringify(items), { status: 200, headers });
}

const recorded = [
	ticket(1, "closed", "completed"),
	ticket(2, "closed", "not_planned"),
	ticket(3, "closed", "duplicate"),
	ticket(4, "closed", null),
	ticket(5, "open", null),
	ticket(6, "open", null),
	pullRequest(7),
];

function githubFetch(): Fetch {
	return async (input) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const first = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
		const second = `https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=2`;
		if (url === first) {
			return page(recorded.slice(0, 4), second);
		}
		if (url === second) {
			return page(recorded.slice(4), null);
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function withConfig(
	body: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-"));
	const path = join(dir, "config.json");
	await writeFile(path, body);
	return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("GET /api/overview", () => {
	test("a GitHub list failure does not serve an overview", async () => {
		const { path, cleanup } = await withConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const failing: Fetch = async (input) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			return new Response("recorded failure", { status: 500 });
		};
		try {
			await expect(
				start({
					configPath: path,
					token: "recorded-token",
					fetch: failing,
					databasePath: ":memory:",
					hostname: "127.0.0.1",
					port: 0,
				}),
			).rejects.toThrow("HTTP 500");
		} finally {
			await cleanup();
		}
	});

	test("counts done, dropped and backlog from recorded GitHub tickets", async () => {
		const { path, cleanup } = await withConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const running = await start({
			configPath: path,
			token: "recorded-token",
			fetch: githubFetch(),
			databasePath: ":memory:",
			hostname: "127.0.0.1",
			port: 0,
		});
		try {
			const response = await fetch(new URL("/api/overview", running.url));
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 2,
						dropped: 2,
						backlog: 2,
					},
				],
			});
			const page = await fetch(new URL("/", running.url));
			expect(page.status).toBe(200);
			expect(page.headers.get("content-type")).toContain("text/html");
			const html = await page.text();
			expect(html).toContain('id="root"');
			expect(html).toContain('src="/cards.js"');
			const script = await fetch(new URL("/cards.js", running.url));
			expect(script.status).toBe(200);
			expect(script.headers.get("content-type")).toContain("javascript");
		} finally {
			await running.stop();
			await cleanup();
		}
	});
});
