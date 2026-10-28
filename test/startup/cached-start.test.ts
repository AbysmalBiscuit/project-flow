import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedDiscovery } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { recordedFetch, valid } from "./_support.ts";

describe("startup", () => {
	test("a restart serves the cached overview before a blocked tracker request completes", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-cache-open-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let releaseTracker: () => void = () => {};
		const trackerHeld = new Promise<void>((resolve) => {
			releaseTracker = resolve;
		});
		let trackerCompleted = 0;
		const blockingFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost")
			) {
				return fetch(input, init);
			}
			await trackerHeld;
			trackerCompleted += 1;
			return recordedFetch(200)(input, init);
		};
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			await fill;
			stopFill();
			await fillRun;
			const first = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: blockingFetch,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch((error: unknown) => {
										reject(error);
									});
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				);
			});
			expect(trackerCompleted).toBe(0);
			expect(first.projects.map((project) => project.name)).toEqual([
				"acme/widget",
			]);
			expect(first.fetchedAt).not.toBeNull();
		} finally {
			releaseTracker();
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed refresh during the first poll leaves the cold start good", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: "acme/widget" },
					{ tracker: "github", repo: "acme/platform" },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-cold-refresh-"));
		let releasePlatform: () => void = () => {};
		const platformReleased = new Promise<void>((resolve) => {
			releasePlatform = resolve;
		});
		let platformAsked: () => void = () => {};
		const platformHeld = new Promise<void>((resolve) => {
			platformAsked = resolve;
		});
		let failing = false;
		let refreshFailed: () => void = () => {};
		const refreshRead = new Promise<void>((resolve) => {
			refreshFailed = resolve;
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return recordedFetch(200)(input, init);
			}
			if (`${url} ${body}`.includes("acme/platform") && !failing) {
				platformAsked();
				await platformReleased;
			}
			if (failing && recordedDiscovery(input, init) === null) {
				if (body.includes('"name":"widget"')) {
					refreshFailed();
				}
				return new Response("recorded failure", { status: 500 });
			}
			return recordedFetch(200)(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					await platformHeld;
					const overview = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as Overview;
					expect(overview.projects.map((project) => project.name)).toContain(
						"acme/widget",
					);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					failing = true;
					releasePlatform();
					await refreshRead;
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: fetchImpl,
						readGhToken: async () => null,
						databasePath: join(root, "project-flow.sqlite"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releasePlatform();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a thrown token check logs the error and keeps serving", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-token-throw-"));
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
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				throw new Error("token check timed out");
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("token check timed out");
			expect(result.listened).toBe(true);
			expect((await checks).projects[0]?.name).toBe("acme/widget");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank token check error still logs and keeps serving", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-token-blank-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<number>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((response) => resolve(response.status))
					.catch(reject);
			};
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				throw "   ";
			}
			return recordedFetch(200)(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "   " },
					fetch: fetchImpl,
					readGhToken: async () => "recorded-token",
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("credential check failed");
			expect(result.listened).toBe(true);
			expect(await checks).toBe(200);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a 503 Linear key check logs the status and keeps serving the cache", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-linear-503-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { LINEAR_API_KEY: "recorded-linear-key" },
				fetch: linearFake(),
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		const unavailable: Fetch = async (input, init) => {
			if (urlOf(input) === "https://api.linear.app/graphql") {
				return new Response("unavailable", { status: 503 });
			}
			return linearFake()(input, init);
		};
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			await fill;
			stopFill();
			await fillRun;
			const overview = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { LINEAR_API_KEY: "recorded-linear-key" },
							fetch: unavailable,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				);
			});
			expect(overview.projects.map((project) => project.name)).toEqual([
				"Widget launch",
			]);
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, listened: true });
			if (
				typeof result === "object" &&
				result !== null &&
				"stderr" in result &&
				typeof result.stderr === "string"
			) {
				expect(result.stderr).toContain("HTTP 503");
			}
		} finally {
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a 503 token check keeps serving the cached overview", async () => {
		const { path, cleanup } = await tempConfig(valid);
		const root = await mkdtemp(join(tmpdir(), "project-flow-token-503-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: () => void = () => {};
		const fill = new Promise<void>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			await fill;
			stopFill();
			await fillRun;
			const overview = await new Promise<Overview>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: recordedFetch(503),
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void fetch(new URL("/api/overview", line))
									.then(async (response) => {
										expect(response.status).toBe(200);
										resolve((await response.json()) as Overview);
									})
									.catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				).then((result) => {
					reject(
						new Error(
							`app exited ${result.exitCode} before the overview was served: ${result.stderr}`,
						),
					);
					return result;
				}, reject);
			});
			expect(overview.projects.map((project) => project.name)).toEqual([
				"acme/widget",
			]);
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, listened: true });
			if (
				typeof result === "object" &&
				result !== null &&
				"stderr" in result &&
				typeof result.stderr === "string"
			) {
				expect(result.stderr).toContain("HTTP 503");
			}
		} finally {
			stopFill();
			stopRestart();
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
