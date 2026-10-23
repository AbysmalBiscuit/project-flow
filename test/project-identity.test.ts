import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "../src/configuration.ts";
import type { Overview, SettingsProject } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { missingToken } from "../src/github.ts";
import { run } from "../src/main.ts";
import {
	githubPullNode,
	linearFake,
	recordedViewer,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	trackerRequest,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";

function github(): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		if (url.startsWith("https://api.github.com/user/repos")) {
			return Response.json([
				{
					full_name: repo,
					owner: { login: "lev" },
					permissions: { push: true },
					pushed_at: "2026-08-01T12:00:00.000Z",
				},
			]);
		}
		const request = trackerRequest(input, init);
		if (request.query.includes("query RepoRead")) {
			return Response.json(
				repoReadIssues("acme", "widget", [], {
					pulls: [githubPullNode({ number: 2, repo })],
				}),
			);
		}
		return recordedViewer(input, init) ?? unrecorded(input, init);
	};
}

async function withApp(
	configuration: unknown,
	check: (base: string) => Promise<void>,
	env: Record<string, string> = {
		GITHUB_TOKEN: "recorded-token",
		LINEAR_API_KEY: "recorded-linear-key",
	},
): Promise<void> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-identity-"));
	const { path, cleanup } = await tempConfig(JSON.stringify(configuration));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: linearFake({
					project: { id: "twin", name: "Linear twin", slugId: repo },
					issues: [],
					github: github(),
				}),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

async function settingsRows(base: string): Promise<SettingsProject[]> {
	await settledOverview(
		base,
		async (url) =>
			(await (await fetch(new URL("/api/overview", url))).json()) as Overview,
	);
	const settings = (await (
		await fetch(new URL("/api/settings", base))
	).json()) as Configuration & { projects: SettingsProject[] };
	return settings.projects;
}

describe("project identity", () => {
	test("a Linear project and a GitHub repo with the same key stay two projects in Settings", async () => {
		await withApp(
			{
				tracked: [{ tracker: "github", repo }],
				expectedBots: { [repo]: ["grok"] },
			},
			async (base) => {
				const rows = await settingsRows(base);
				const pick = ({
					key,
					tracker,
					tracked,
					repos,
					expectedBots,
				}: SettingsProject) => ({
					key,
					tracker,
					tracked,
					repos,
					expectedBots,
				});
				expect(rows.map(pick)).toEqual([
					{
						key: repo,
						tracker: "linear",
						tracked: false,
						repos: [],
						expectedBots: [],
					},
					{
						key: repo,
						tracker: "github",
						tracked: true,
						repos: [repo],
						expectedBots: ["grok"],
					},
				]);
			},
		);
	});

	test("a repo named in mixed case matches the repo that discovery finds", async () => {
		await withApp(
			{ tracked: [{ tracker: "github", repo: "Acme/Widget" }] },
			async (base) => {
				const rows = await settingsRows(base);
				expect(
					rows
						.filter((row) => row.tracker === "github")
						.map(({ key, source, tracked }) => ({ key, source, tracked })),
				).toEqual([{ key: repo, source: "found", tracked: true }]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(overview.projects.map((project) => project.name)).toEqual([
					repo,
				]);
			},
		);
	});

	test("a GitHub repo and a GitHub project with the same key stay two projects", async () => {
		await withApp(
			{
				tracked: [
					{ tracker: "github", repo: "acme/42" },
					{ tracker: "github", owner: "acme", project: 42 },
				],
			},
			async (base) => {
				const overview = await settledOverview(
					base,
					async (url) =>
						(await (
							await fetch(new URL("/api/overview", url))
						).json()) as Overview,
				);
				expect(
					overview.projects.map(({ ref, error }) => ({ ref, error })),
				).toEqual([
					{ ref: { tracker: "github", repo: "acme/42" }, error: missingToken },
					{
						ref: { tracker: "github", owner: "acme", project: 42 },
						error: missingToken,
					},
				]);
			},
			{ LINEAR_API_KEY: "recorded-linear-key" },
		);
	});
});
