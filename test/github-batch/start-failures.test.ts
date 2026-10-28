import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { membership } from "./_support.ts";

describe("batched GitHub reads", () => {
	test("a blank tracked repo fails before any GitHub request", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "   " }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(
				sent.filter((url) => url.startsWith("https://api.github.com/")),
			).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a repo name with repeated spaces fails before any GitHub request", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme  repo" }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(
				sent.filter((url) => url.startsWith("https://api.github.com/")),
			).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GraphQL error on RepoRead fails the start", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/repo-0" }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("GitHub read repo failed");
			expect(sent.filter((url) => url.includes("/issues?"))).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
