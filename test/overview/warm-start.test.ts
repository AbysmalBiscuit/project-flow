import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";
import { emptyList } from "./_support.ts";

describe("GET /api/overview", () => {
	test("a stop during a poll ends the process within 5 seconds and the next start serves the stored data", async () => {
		const repoName = "acme/stop";
		const never = new Promise<Response>(() => {});
		const hung: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost")
			) {
				return fetch(input, init);
			}
			const signal = init?.signal ?? null;
			if (signal?.aborted === true) {
				throw new DOMException("The operation was aborted.", "AbortError");
			}
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener(
					"abort",
					() => {
						reject(
							new DOMException("The operation was aborted.", "AbortError"),
						);
					},
					{ once: true },
				);
				void never;
			});
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-stop-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let stopRestart: () => void = () => {};
		let stopRun: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stopRun = resolve;
		});
		let listening: (base: string) => void = () => {};
		const ready = new Promise<string>((resolve) => {
			listening = resolve;
		});
		const first = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: hung,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => listening(line),
					waitForStop: stopped,
				},
				{ first: true },
			),
		);
		try {
			const base = await ready;
			const opened = await fetch(new URL("/api/overview", base));
			expect(opened.status).toBe(200);
			const before = (await opened.json()) as Overview;
			expect(before.projects[0]?.tickets[0]?.key).toBe(`${repoName}#4`);
			const started = Date.now();
			stopRun();
			const ended = await first;
			expect(ended.exitCode).toBe(0);
			expect(Date.now() - started).toBeLessThan(5_000);
			const restartStopped = new Promise<void>((resolve) => {
				stopRestart = resolve;
			});
			let restartChecks: (line: string) => void = () => {};
			const restartDone = new Promise<void>((resolve, reject) => {
				restartChecks = (line) => {
					void (async () => {
						const response = await fetch(new URL("/api/overview", line));
						expect(response.status).toBe(200);
						const body = (await response.json()) as Overview;
						expect(body.error).toBeNull();
						expect(body.projects[0]?.error).toBeNull();
						expect(body.projects[0]?.tickets).toEqual([
							{
								key: `${repoName}#4`,
								title: "Ticket 4",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						]);
						resolve();
					})().catch(reject);
				};
			});
			const restartRun = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: hung,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => restartChecks(line),
						waitForStop: restartStopped,
					},
					{ first: true },
				),
			);
			await restartDone;
			stopRestart();
			const restart = await restartRun;
			expect(restart.stderr).toBe("");
			expect(restart.exitCode).toBe(0);
		} finally {
			stopRun();
			stopRestart();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a warm start releases the first poll when the overview is read", async () => {
		const repoName = "acme/warm-release";
		let repoReads = 0;
		let releaseRead: () => void = () => {};
		const readHeld = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				repoReads += 1;
				await readHeld;
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-warm-release-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					await Bun.sleep(100);
					expect(repoReads).toBe(0);
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					while (repoReads === 0) {
						await Bun.sleep(20);
					}
					expect(repoReads).toBe(1);
					releaseRead();
					resolve();
				})().catch((error: unknown) => {
					releaseRead();
					reject(error);
				});
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseRead();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a warm start runs one poll until the poll interval passes", async () => {
		const repoName = "acme/warm";
		const intervalSecondMs = 100;
		const requests: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstHeld = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let repoReads = 0;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const local =
				url.startsWith("http://127.0.0.1") ||
				url.startsWith("http://localhost");
			if (!local) {
				requests.push(url);
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				repoReads += 1;
				await firstHeld;
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
					{ etag: '"warm-issues"' },
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 1,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-warm-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table snapshots (
				snapshot_key text primary key,
				name text not null,
				tracker text not null,
				payload text not null
			)
		`);
		seeded
			.query(
				"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
			)
			.run(
				`github:${repoName}`,
				repoName,
				"github",
				JSON.stringify({
					tickets: [
						{
							id: "4",
							tracker: "github",
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "open",
							stateReason: null,
							updatedAt: "2026-10-18T12:00:00.000Z",
							ref: `${repoName}#4`,
							body: "",
							blockedBy: [],
							milestone: null,
							parent: null,
							labels: [],
						},
					],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.run(`
			create table project_polls (
				project text primary key,
				fetched_at text not null
			)
		`);
		seeded
			.query("insert into project_polls (project, fetched_at) values (?, ?)")
			.run(repoName, "2026-10-18T12:00:00.000Z");
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					const before = (await opened.json()) as Overview;
					expect(before.projects.map((project) => project.name)).toEqual([
						repoName,
					]);
					await Bun.sleep(intervalSecondMs + 250);
					const during = repoReads;
					expect(during).toBe(1);
					releaseFirst();
					await Bun.sleep(50);
					expect(repoReads).toBeLessThan(3);
					const after = await fetch(new URL("/api/overview", base));
					expect(after.status).toBe(200);
					const kept = (await after.json()) as Overview;
					expect(kept.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					resolve();
				})().catch((error: unknown) => {
					releaseFirst();
					reject(error);
				});
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo(
					{
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						intervalSecondMs,
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releaseFirst();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
