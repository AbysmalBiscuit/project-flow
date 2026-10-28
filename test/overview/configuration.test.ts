import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { readGhAuthToken } from "../../src/token-commands.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { emptyProjectFields, page, unrecorded } from "../support/github.ts";
import { trackFound } from "../support/reads.ts";
import { emptyList, githubFetch, githubTicket } from "./_support.ts";

describe("GET /api/overview", () => {
	test("an empty configuration with no membership shows no projects", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({}));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
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
					fetch: githubFetch([]),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const empty = (await checks) as Overview;
			expect(empty).toEqual({
				projects: [],
				fetchedAt: empty.fetchedAt,
				error: null,
				tracked: false,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank configuration file shows no projects", async () => {
		const { path, cleanup } = await tempConfig("   \n");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const result = await run(
				["--config", `  ${path}  `],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: githubFetch([]),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("not JSON");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty configuration takes the GitHub token from gh and lists found projects", async () => {
		const foundRepo = "lev/found-widget";
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const authorizations: string[] = [];
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const headers = new Headers(init?.headers);
			const authorization = headers.get("authorization");
			if (authorization !== null) {
				authorizations.push(authorization);
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: foundRepo,
							owner: { login: "lev" },
							permissions: { admin: true, push: true, pull: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${foundRepo}/issues?`)) {
				return page([githubTicket(1, "open", null)], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: recorded,
					readGhToken: async () => "gh-printed-token",
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body.projects.map((project) => project.name)).toEqual([foundRepo]);
			expect(body.projects[0]).toMatchObject({
				tracker: "github",
				error: null,
			});
			expect(body.error).toBeNull();
			expect(authorizations).toContain("Bearer gh-printed-token");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty configuration with no gh starts and names GITHUB_TOKEN on GitHub projects", async () => {
		const foundRepo = "lev/found-widget";
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const bin = await mkdtemp(join(tmpdir(), "project-flow-no-gh-"));
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.startsWith("https://api.github.com/")) {
				throw new Error("GitHub must not be called without a token");
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				trackFound(base)
					.then(() => fetch(new URL("/api/overview", base)))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { PATH: bin },
					fetch: recorded,
					readGhToken: readGhAuthToken,
					databasePath: join(root, "project-flow.sqlite"),
					listCheckouts: async () => [
						{
							tracker: "github",
							path: "/var/tmp/lev/found-widget",
							repo: foundRepo,
							originOwner: "lev",
							hasTrackerConfig: true,
							names: [],
						},
					],
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = (await checks) as Overview;
			expect(body.projects.map((project) => project.name)).toContain(foundRepo);
			expect(
				body.projects.find((project) => project.name === foundRepo)?.error,
			).toContain("GITHUB_TOKEN");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("a blank gh token and a blank checkout root start with no GitHub projects", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ checkoutRoots: ["   "] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const stray = await mkdtemp(join(tmpdir(), "project-flow-stray-"));
		await writeFile(join(stray, "note.txt"), "untracked");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "   " },
					fetch: async () => {
						throw new Error("GitHub must not be called for a blank token");
					},
					readGhToken: async () => "   ",
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const body = (await checks) as Overview;
			expect(body.projects).toEqual([]);
			expect(body.error).toBeNull();
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
			await rm(stray, { recursive: true, force: true });
		}
	});
});
