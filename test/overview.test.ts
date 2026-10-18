import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, urlOf } from "./support.ts";

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
		const url = urlOf(input);
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

async function assertCard(base: string): Promise<void> {
	const response = await fetch(new URL("/api/overview", base));
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
	const pageResponse = await fetch(new URL("/", base));
	expect(pageResponse.status).toBe(200);
	expect(pageResponse.headers.get("content-type")).toContain("text/html");
	const html = await pageResponse.text();
	expect(html).toContain(repo);
	expect(html).toContain("Done 2");
	expect(html).toContain("Dropped 2");
	expect(html).toContain("Backlog 2");
	expect(html).not.toContain("/cards.js");
	const script = await fetch(new URL("/cards.js", base));
	expect(script.status).toBe(404);
}

describe("GET /api/overview", () => {
	test("a GitHub list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const failing: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			return new Response("recorded failure", { status: 500 });
		};
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: failing,
				readGhToken: async () => null,
				databasePath: ":memory:",
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("counts done, dropped and backlog from recorded GitHub tickets", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				assertCard(base).then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: githubFetch(),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
