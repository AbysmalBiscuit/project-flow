import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const githubRepo = "acme/widget";
const linearSlug = "widget-launch-0d42ae5d46d0";
const linearName = "Widget launch";

function overviewOf(base: string): Promise<Overview> {
	return fetch(new URL("/api/overview", base)).then(
		async (response) => (await response.json()) as Overview,
	);
}

async function listen(
	path: string,
	env: Record<string, string | undefined>,
	fetchImpl: Fetch,
	databasePath: string,
): Promise<{ result: Awaited<ReturnType<typeof run>>; body: Overview }> {
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<Overview>((resolve, reject) => {
		startChecks = (base: string) => {
			overviewOf(base).then(resolve, reject);
		};
	});
	const result = await run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env,
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
			stdout: (line) => startChecks(line),
			waitForStop: checks.then(() => undefined),
		}),
	);
	if (!result.listened) {
		throw new Error(
			`startup exited ${result.exitCode}: ${result.stderr || result.stdout}`,
		);
	}
	return { result, body: await checks };
}

function githubLists(seen: string[]): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		seen.push(url);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url.includes(`/repos/${githubRepo}/issues`)) {
			return new Response(
				JSON.stringify([
					{
						number: 1,
						title: "Recorded ticket",
						state: "open",
						state_reason: null,
						html_url: `https://github.com/${githubRepo}/issues/1`,
						updated_at: "2026-10-18T12:00:00.000Z",
					},
				]),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.includes("/check-runs")) {
			return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
		}
		if (url === "https://api.github.com/graphql") {
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				}),
				{ status: 200 },
			);
		}
		return new Response("not recorded", { status: 404 });
	};
}

function linearLists(seen: string[]): Fetch {
	return linearFake({
		project: {
			id: "project-1",
			name: linearName,
			slugId: linearSlug,
		},
		issues: [
			{
				id: "issue-1",
				identifier: "WID-1",
				title: "Recorded Linear ticket",
				state: { type: "started" },
				updatedAt: "2026-10-18T12:00:00.000Z",
			},
		],
		requests: seen,
		github: async () => {
			throw new Error("GitHub must not be called without a token");
		},
	});
}

describe("a missing credential marks its projects", () => {
	test("no GitHub token marks pinned GitHub projects and polls Linear", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 7 },
					{ tracker: "linear", project: linearSlug },
				],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-cred-"));
		const linearRequests: string[] = [];
		try {
			const { result, body } = await listen(
				path,
				{ LINEAR_API_KEY: "recorded-linear-key" },
				linearLists(linearRequests),
				join(root, "project-flow.sqlite"),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("");
			const github = body.projects.filter(
				(project) => project.tracker === "github",
			);
			expect(github.map((project) => project.name).sort()).toEqual([
				"acme/7",
				githubRepo,
			]);
			expect(
				github.every((project) => project.error?.includes("GITHUB_TOKEN")),
			).toBe(true);
			const linear = body.projects.find(
				(project) => project.tracker === "linear",
			);
			expect(linear?.name).toBe(linearName);
			expect(linear?.error).toBeNull();
			expect(
				linearRequests.some((body) => body.includes("ProjectIssues")),
			).toBe(true);
			expect(body.error).toBeNull();
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("no Linear key marks pinned Linear projects and polls GitHub", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "linear", project: linearSlug },
				],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-cred-"));
		const githubRequests: string[] = [];
		try {
			const { result, body } = await listen(
				path,
				{ GITHUB_TOKEN: "recorded-token" },
				githubLists(githubRequests),
				join(root, "project-flow.sqlite"),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("");
			const linear = body.projects.find(
				(project) => project.tracker === "linear",
			);
			expect(linear?.name).toBe(linearSlug);
			expect(linear?.error).toContain("LINEAR_API_KEY");
			const github = body.projects.find(
				(project) => project.tracker === "github",
			);
			expect(github?.name).toBe(githubRepo);
			expect(github?.error).toBeNull();
			expect(
				githubRequests.some((url) =>
					url.includes(`/repos/${githubRepo}/issues`),
				),
			).toBe(true);
			expect(body.error).toBeNull();
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
