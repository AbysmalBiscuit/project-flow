import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run, type RunIo } from "../src/main.ts";
import {
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
} from "./support.ts";

const valid = JSON.stringify({
	pinned: [{ tracker: "github", repo: "acme/widget" }],
});

const io: RunIo = {
	env: {},
	fetch: async (input, init) =>
		recordedDiscovery(input, init) ?? unrecorded(input, init),
	readGhToken: async () => null,
	waitForStop: Promise.resolve(),
};

describe("--config", () => {
	test.each([
		["last", ["--config"]],
		["followed by a flag", ["--config", "--port", "4000"]],
	])("a --config %s exits 1 and does not listen", async (_, configArgs) => {
		const result = await run(configArgs, testIo(io));
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe(
			"invalid configuration: --config needs a file path",
		);
		expect(result.listened).toBe(false);
	});

	test("--config with a path followed by --port listens", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, databasePath: join(root, "project-flow.sqlite") }),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
