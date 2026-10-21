import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	repoReadFromLists,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const board = "acme/board";
const widget = {
	id: "widget",
	name: "Widget launch",
	slugId: "widget-launch",
};

function githubIssue(number: number, title: string): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${board}/issues/${number}`,
	};
}

const githubIssues = [
	githubIssue(12, "Ship the widget"),
	githubIssue(3, "Hold the launch"),
];

const linearIssues = [
	{
		id: "BIL-4",
		identifier: "BIL-4",
		title: "Ship the invoice",
		description: "",
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		labels: { nodes: [] },
		comments: { nodes: [] },
		assignee: null,
	},
	{
		id: "BIL-9",
		identifier: "BIL-9",
		title: "Widget tax copy",
		description: "",
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		labels: { nodes: [] },
		comments: { nodes: [] },
		assignee: null,
	},
];

function recorded(requests: string[]): Fetch {
	const linear = linearFake({ project: widget, issues: linearIssues });
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		requests.push(url);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const listed = repoReadFromLists(input, init, { [board]: githubIssues });
		if (listed !== null) {
			requests.push(`https://api.github.com/repos/${board}/issues?`);
			return listed;
		}
		if (url.startsWith(`https://api.github.com/repos/${board}/issues?`)) {
			return Response.json(githubIssues);
		}
		if (
			url.startsWith("https://api.github.com/repos/") &&
			url.includes("/issues?")
		) {
			return Response.json([]);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return Response.json([]);
		}
		if (url.includes("/dependencies/blocked_by")) {
			return Response.json([]);
		}
		return linear(input, init);
	};
}

describe("ticket search", () => {
	test("returns matching tickets across projects by key and title", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: board },
					{ tracker: "linear", project: "widget-launch" },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const requests: string[] = [];
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{
			byKey: unknown;
			byTitle: unknown;
			blank: unknown;
			miss: unknown;
		}>((resolve, reject) => {
			startChecks = (base) => {
				const search = (q: string) =>
					fetch(new URL(`/api/search?q=${encodeURIComponent(q)}`, base)).then(
						async (response) => {
							expect(response.status).toBe(200);
							return response.json();
						},
					);
				Promise.all([
					search("acme/board#12"),
					search("ship"),
					search("   "),
					search("missing"),
				])
					.then(([byKey, byTitle, blank, miss]) => {
						resolve({ byKey, byTitle, blank, miss });
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: recorded(requests),
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const found = await checks;
			expect(found.byKey).toEqual([
				{
					project: board,
					tracker: "github",
					key: `${board}#12`,
					title: "Ship the widget",
					state: "backlog",
				},
			]);
			expect(found.byTitle).toEqual([
				{
					project: board,
					tracker: "github",
					key: `${board}#12`,
					title: "Ship the widget",
					state: "backlog",
				},
				{
					project: "Widget launch",
					tracker: "linear",
					key: "BIL-4",
					title: "Ship the invoice",
					state: "backlog",
				},
			]);
			expect(found.blank).toEqual([]);
			expect(found.miss).toEqual([]);
			expect(requests.length).toBeGreaterThan(0);
			expect(
				requests.every(
					(url) =>
						url.startsWith("https://api.github.com/") ||
						url.startsWith("https://api.linear.app/"),
				),
			).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
