import { describe, expect, test } from "bun:test";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { recordedFetch, valid } from "./_support.ts";

describe("startup", () => {
	test("a blank --config exits 1 and does not listen", async () => {
		const result = await run(
			["--config", "   "],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("an empty --config exits 1 and does not listen", async () => {
		const result = await run(
			["--config"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--config");
		expect(result.listened).toBe(false);
	});

	test("an empty --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--port"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a non-numeric --port exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--port", "nope"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--port");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a --port above 65535 exits 1 and does not listen", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--port", "65536"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch(200),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("invalid port: --port needs a port number");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});
});
