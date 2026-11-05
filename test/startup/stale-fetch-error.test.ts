import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { sqliteStore } from "../../src/store.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedDiscovery } from "../support/github.ts";
import { recordedFetch, valid } from "./_support.ts";

const staleError = "tracker request timed out after 30 s";

/** Starts the app on a store without tickets that holds a fetch error of an earlier session. */
async function startOnStaleStore(configuration: string, fetchImpl: Fetch) {
	const { path, cleanup } = await tempConfig(configuration);
	const root = await mkdtemp(join(tmpdir(), "project-flow-stale-error-"));
	const databasePath = join(root, "project-flow.sqlite");
	const seeded = sqliteStore(databasePath);
	seeded.store.recordFetchError(staleError);
	seeded.close();
	let served: (status: number) => void = () => {};
	const overviewStatus = new Promise<number>((resolve) => {
		served = resolve;
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => {
					void fetch(new URL("/api/overview", line)).then(
						(response) => served(response.status),
						() => served(0),
					);
				},
				waitForStop: overviewStatus.then(() => undefined),
			}),
		);
		return { result, overviewStatus };
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("startup on a store with a stale fetch error", () => {
	test("a configuration without ticket sources starts and serves the overview", async () => {
		const { result, overviewStatus } = await startOnStaleStore(
			JSON.stringify({ pinned: [] }),
			recordedFetch(200),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(await overviewStatus).toBe(200);
	});

	test("a failed first poll exits with its own error", async () => {
		const failing: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (urlOf(input) === "https://api.github.com/user") {
				return recordedFetch(200)(input, init);
			}
			return new Response("recorded failure", { status: 500 });
		};
		const { result } = await startOnStaleStore(valid, failing);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("HTTP 500");
		expect(result.stderr).not.toContain(staleError);
		expect(result.listened).toBe(true);
	});
});
