import { describe, expect, test } from "bun:test";

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

describe("--host", () => {
	test.each([
		["last", ["--host"]],
		["followed by a flag", ["--host", "--port", "4000"]],
	])("a --host %s exits 1 and does not listen", async (_, hostArgs) => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(["--config", path, ...hostArgs], testIo(io));
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("invalid host: --host needs a host name");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("--host 0.0.0.0 listens on 0.0.0.0", async () => {
		const { path, cleanup } = await tempConfig(valid);
		try {
			const result = await run(
				["--config", path, "--host", "0.0.0.0", "--port", "0"],
				testIo(io),
			);
			expect(result.listened).toBe(true);
			expect(new URL(result.stdout.trim()).hostname).toBe("0.0.0.0");
		} finally {
			await cleanup();
		}
	});
});
