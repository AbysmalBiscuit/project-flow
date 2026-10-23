import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	defaultStateColours,
	recordedDiscovery,
	testIo,
	unrecorded,
	writtenColours,
} from "./support.ts";

const discoveryOnly: Fetch = async (input, init) =>
	recordedDiscovery(input, init) ?? unrecorded(input);

describe("configuration file", () => {
	test("repeated spaces in --config still create the named file", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "spaced config.json");
		const store = join(root, "store");
		try {
			const result = await run(
				["--config", `  ${path}  `],
				testIo({
					env: {},
					fetch: discoveryOnly,
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await writtenColours(path)).toEqual(defaultStateColours);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a missing configuration file is created with the default state colours and serves the overview", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "config.json");
		const store = join(root, "store");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<{ status: number; body: unknown }>(
			(resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", base));
						resolve({ status: response.status, body: await response.json() });
					})().catch(reject);
				};
			},
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: discoveryOnly,
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe(`created configuration file: ${path}`);
			expect(result.exitCode).toBe(0);
			expect(await writtenColours(path)).toEqual(defaultStateColours);
			const overview = await checks;
			expect(overview.status).toBe(200);
			expect(overview.body).toMatchObject({ projects: [], error: null });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a directory at the configuration path is not created over", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "config-dir");
		await mkdir(path);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {},
					fetch: discoveryOnly,
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(root, "store", "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(`configuration file cannot be read: ${path}`);
			expect(result.listened).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a start creates the missing parent folder of the configuration file", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-config-"));
		const path = join(root, "missing", "nested", "config.json");
		const store = join(root, "store");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {},
					fetch: discoveryOnly,
					readGhToken: async () => null,
					listCheckouts: async () => [],
					databasePath: join(store, "project-flow.sqlite"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await writtenColours(path)).toEqual(defaultStateColours);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
