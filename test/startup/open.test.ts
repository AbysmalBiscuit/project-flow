import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";

describe("startup", () => {
	test("without --open the injected opener is not called", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
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
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
			expect(opened).toEqual([]);
		} finally {
			await cleanup();
		}
	});

	test("--open opens the printed URL once after the server listens", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
						const page = await fetch(url);
						expect(page.ok).toBe(true);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
			expect(opened).toEqual([result.stdout]);
		} finally {
			await cleanup();
		}
	});

	test("a pending opener does not block stop", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		let releaseOpen: () => void = () => {};
		const openerPending = new Promise<void>((resolve) => {
			releaseOpen = resolve;
		});
		let openedUrl = "";
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: (url) => {
						openedUrl = url;
						return openerPending;
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(openedUrl).toBe(result.stdout);
			const page = await fetch(openedUrl).catch((error: unknown) => error);
			expect(page).toBeInstanceOf(Error);
		} finally {
			releaseOpen();
			await cleanup();
		}
	});

	test("a failed opener prints one warning and the API still answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		let checked = "";
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<boolean>((resolve, reject) => {
			startChecks = (base: string) => {
				checked = base;
				fetch(new URL("/api/overview", base))
					.then((page) => resolve(page.ok))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
					open: async (url) => {
						opened.push(url);
						throw new Error("browser missing");
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(result.stderr).toBe("warning: could not open the browser");
			expect(opened).toEqual([checked]);
			expect(await checks).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("--open with a failing browser command warns and the API still answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const bin = await mkdtemp(join(tmpdir(), "project-flow-bad-browser-"));
		for (const name of ["powershell.exe", "wslview", "xdg-open", "open"]) {
			const program = join(bin, name);
			await writeFile(program, "#!/bin/sh\nexit 1\n");
			await chmod(program, 0o755);
		}
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<boolean>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((page) => resolve(page.ok))
					.catch(reject);
			};
		});
		let sawWarning: (line: string) => void = () => {};
		const warned = new Promise<string>((resolve) => {
			sawWarning = resolve;
		});
		const warnings: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: { PATH: bin },
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => startChecks(line),
					stderr: (line) => {
						warnings.push(line);
						if (line === "warning: could not open the browser") {
							sawWarning(line);
						}
					},
					waitForStop: Promise.all([checks, warned]).then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(warnings).toEqual(["warning: could not open the browser"]);
			expect(await warned).toBe("warning: could not open the browser");
			expect(await checks).toBe(true);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("--open= is an unknown flag and does not open a browser", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open="],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.listened).toBe(false);
			expect(opened).toEqual([]);
			expect(result.stderr).toBe("unknown flag: --open= (see --help)");
		} finally {
			await cleanup();
		}
	});

	test("repeated --open still opens the printed URL once", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const opened: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open", "--open"],
				testIo({
					env: {},
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
					open: async (url) => {
						opened.push(url);
					},
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(opened).toEqual([result.stdout]);
		} finally {
			await cleanup();
		}
	});

	test("--open with no browser command warns and the API still answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const bin = await mkdtemp(join(tmpdir(), "project-flow-no-browser-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<boolean>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((page) => resolve(page.ok))
					.catch(reject);
			};
		});
		let sawWarning: (line: string) => void = () => {};
		const warned = new Promise<string>((resolve) => {
			sawWarning = resolve;
		});
		const warnings: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: { PATH: bin },
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => startChecks(line),
					stderr: (line) => {
						warnings.push(line);
						if (line === "warning: could not open the browser") {
							sawWarning(line);
						}
					},
					waitForStop: Promise.all([checks, warned]).then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(warnings).toEqual(["warning: could not open the browser"]);
			expect(await checks).toBe(true);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
		}
	});

	test("--open warns when the browser command exits after the API answers", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const bin = await mkdtemp(join(tmpdir(), "project-flow-slow-browser-"));
		for (const name of ["powershell.exe", "wslview", "xdg-open", "open"]) {
			const program = join(bin, name);
			await writeFile(program, "#!/bin/sh\n/bin/sleep 0.3\nexit 1\n");
			await chmod(program, 0o755);
		}
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<boolean>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then((page) => resolve(page.ok))
					.catch(reject);
			};
		});
		let sawWarning: (line: string) => void = () => {};
		const warned = new Promise<string>((resolve) => {
			sawWarning = resolve;
		});
		const warnings: string[] = [];
		try {
			const result = await run(
				["--config", path, "--open"],
				testIo({
					env: { PATH: bin },
					fetch: async () => {
						throw new Error("no tracker call for an empty pin list");
					},
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => startChecks(line),
					stderr: (line) => {
						warnings.push(line);
						if (line === "warning: could not open the browser") {
							sawWarning(line);
						}
					},
					waitForStop: Promise.all([checks, warned]).then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(warnings).toEqual(["warning: could not open the browser"]);
			expect(await warned).toBe("warning: could not open the browser");
			expect(await checks).toBe(true);
		} finally {
			await cleanup();
			await rm(bin, { recursive: true, force: true });
		}
	});
});
