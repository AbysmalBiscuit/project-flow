import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { missingToken, rejectedToken, run } from "../../src/main.ts";
import { readGhAuthToken } from "../../src/token-commands.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedFetch, valid } from "./_support.ts";

describe("startup", () => {
	test("an empty configuration with a rejected GITHUB_TOKEN exits 1", async () => {
		const { path, cleanup } = await tempConfig("{}");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "rejected-token" },
					fetch: async (input) => {
						const url = urlOf(input);
						if (url === "https://api.github.com/user") {
							return new Response(
								JSON.stringify({ message: "Bad credentials" }),
								{ status: 401 },
							);
						}
						throw new Error(`unexpected tracker call: ${url}`);
					},
					readGhToken: async () => {
						throw new Error("gh must not run when GITHUB_TOKEN is set");
					},
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("an empty pinned list starts without GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("");
		} finally {
			await cleanup();
		}
	});

	test("a missing token serves and names GITHUB_TOKEN on the pinned project", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: recordedFetch(401),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing gh executable serves and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const bin = await mkdtemp(join(tmpdir(), "project-flow-no-gh-"));
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { PATH: bin },
					fetch: recordedFetch(200),
					readGhToken: readGhAuthToken,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a rejected token exits 1 and names GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "rejected-token" },
					fetch: recordedFetch(401),
					readGhToken: async () => {
						throw new Error("gh must not run when GITHUB_TOKEN is set");
					},
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(rejectedToken);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a non-ok token check logs the status and keeps listening", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(500),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
			expect((await checks).projects[0]?.name).toBe("acme/widget");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank GITHUB_TOKEN serves and names the token", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-startup-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<Overview>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) =>
						resolve((await response.json()) as Overview),
					)
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "   " },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toBe(missingToken);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
