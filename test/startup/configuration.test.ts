import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedFetch, valid } from "./_support.ts";

describe("startup", () => {
	test("a blank notification trigger names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				notificationTriggers: { needsYou: "" },
			}),
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.listened).toBe(false);
			expect(result.stderr).toContain("notificationTriggers.needsYou");
		} finally {
			await cleanup();
		}
	});

	test("a configuration with noSenior exits 1 and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				noSenior: { "acme/widget": true },
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("noSenior");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("an empty pmBot map starts and serves the overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget" }],
				pmBot: {},
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<number>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/overview", base))
					.then((response) => resolve(response.status))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(await checks).toBe(200);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an invalid configuration exits 1 and names the field", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/widget", extra: true }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pinned.0.extra");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a configuration with no Linear pin starts when the Linear viewer query returns HTTP 500", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{ status: number; body: Overview }>(
			(resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", base));
						resolve({
							status: response.status,
							body: (await response.json()) as Overview,
						});
					})().catch(reject);
				};
			},
		);
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.linear.app/graphql") {
				return new Response("linear down", { status: 500 });
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			const overview = await checks;
			expect(overview.status).toBe(200);
			expect(overview.body.projects.length).toBeGreaterThan(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GitHub-only configuration starts without a Linear key", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-data-"));
		const databasePath = join(root, "github-only.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing store directory is created for the run", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-data-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath,
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
