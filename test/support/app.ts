import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectPin } from "../../src/configuration.ts";
import { listDevkitCheckouts } from "../../src/devkit-checkouts.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run, type RunIo } from "../../src/main.ts";
import { answerRecordedRepoRead } from "../recorded-read.ts";
import { repo } from "./github.ts";
import { settledSettings } from "./reads.ts";

export async function tempConfig(
	body: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-"));
	const path = join(dir, "config.json");
	let written = body;
	try {
		const parsed = JSON.parse(body) as { checkoutRoots?: unknown };
		if (parsed.checkoutRoots === undefined) {
			written = JSON.stringify({ ...parsed, checkoutRoots: [] });
		}
	} catch {
		written = body;
	}
	await writeFile(path, written);
	return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// A settings write without checkoutRoots falls back to the user's ~/Git.
// The harness never scans the checkouts of the machine that runs the tests.
const hostCheckoutRoot = join(homedir(), "Git");

export function testIo(io: RunIo, options?: { first?: boolean }): RunIo {
	const stdout = io.stdout;
	const first = options?.first === true;
	const fetchImpl = answerRecordedRepoRead(io.fetch);
	return {
		listTodos: async () => "",
		listCheckouts: (roots) =>
			listDevkitCheckouts(
				roots.filter((root) => root !== hostCheckoutRoot),
				io.env,
			),
		...io,
		fetch: fetchImpl,
		...(stdout === undefined
			? {}
			: {
					stdout: (line: string) => {
						if (first) {
							stdout(line);
							return;
						}
						void (async () => {
							while (true) {
								const response = await fetch(
									new URL("/api/overview", line),
								).catch(() => null);
								if (response === null || !response.ok) {
									break;
								}
								const body = (await response.json()) as { polling?: true };
								if (body.polling !== true) {
									break;
								}
								await Bun.sleep(5);
							}
							// A start on a stored board shows no running poll, but its
							// discovery still changes the Settings catalogue.
							await settledSettings(line).catch(() => {});
							stdout(line);
						})();
					},
				}),
	};
}

export const goodPoll = "2026-04-01T12:00:00.000Z";

export async function withServer(
	fetchImpl: Fetch,
	intervalSeconds: number,
	checks: (base: string, advance: (ms: number) => void) => Promise<void>,
	pinned: ProjectPin[] = [{ tracker: "github", repo }],
	env: Record<string, string | undefined> = {
		GITHUB_TOKEN: "recorded-token",
	},
	clockOffsetMs = 0,
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned, pollIntervalSeconds: intervalSeconds }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (
		base: string,
		advance: (ms: number) => void,
	) => void = () => {};
	let checksError: unknown;
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base: string, advance: (ms: number) => void) => {
			checks(base, advance).then(resolve, (error: unknown) => {
				checksError = error;
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	let ticks = 0;
	let advanced = clockOffsetMs;
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				// One second of the poll interval lasts 100 ms on the poll timer.
				intervalSecondMs: 100,
				now: () => new Date(Date.parse(goodPoll) + advanced + ticks++ * 1_000),
				stdout: (line) =>
					startChecks(line, (ms) => {
						advanced += ms;
					}),
				waitForStop: done,
			}),
		);
		if (checksError !== undefined) {
			throw checksError;
		}
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}
