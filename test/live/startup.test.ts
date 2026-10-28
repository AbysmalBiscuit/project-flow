import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { goodPoll, tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	issuesResponse,
	listedRead,
	listUrl,
	otherRepo,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "../support/github.ts";
import {
	openEventStream,
	type OverviewBody,
	overviewOf,
	readOverview,
	settledOverview,
	settledOverviewEvent,
} from "../support/reads.ts";
import {
	counts,
	githubTicket,
	pushListed,
	unchangedFetch,
} from "./_support.ts";

const thirdRepo = "acme/third";

describe("live updates", () => {
	test("each project reaches the event stream when its own poll ends", async () => {
		const releases = new Map<string, () => void>();
		const held = (name: string) =>
			new Promise<void>((resolve) => {
				releases.set(name, resolve);
			});
		const widgetHeld = held(repo);
		const otherHeld = held(otherRepo);
		const thirdHeld = held(thirdRepo);
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const listed = listedRead(input, init);
			if (listed !== null) {
				const heldFor =
					listed.repo === otherRepo
						? otherHeld
						: listed.repo === thirdRepo
							? thirdHeld
							: widgetHeld;
				await heldFor;
				return (
					issuesResponse(
						input,
						init,
						[ticket(1, "2026-04-01T00:00:00Z")],
						listed.repo,
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
					{ tracker: "github", repo: thirdRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				const stream = openEventStream(base);
				void (async () => {
					await stream.ready;
					releases.get(repo)?.();
					let sawWidget = false;
					let sawOther = false;
					for await (const event of stream.events) {
						if (event.event !== "overview") {
							continue;
						}
						const body = JSON.parse(event.data) as OverviewBody;
						const ready = body.projects.filter(
							(project) => project.pending !== true,
						);
						const names = ready.map((project) => project.name);
						if (!sawWidget) {
							if (names.includes(otherRepo) || names.includes(thirdRepo)) {
								throw new Error(
									"a later project arrived before its poll ended",
								);
							}
							if (names.includes(repo)) {
								sawWidget = true;
								releases.get(otherRepo)?.();
							}
							continue;
						}
						if (!sawOther) {
							if (names.includes(thirdRepo)) {
								throw new Error("third project arrived before its poll ended");
							}
							if (names.includes(otherRepo)) {
								sawOther = true;
								releases.get(thirdRepo)?.();
							}
							continue;
						}
						if (!names.includes(thirdRepo) || body.polling === true) {
							continue;
						}
						expect(body.polling).toBeUndefined();
						expect(ready).toHaveLength(3);
						break;
					}
					expect(sawWidget).toBe(true);
					expect(sawOther).toBe(true);
					stream.close();
					resolve();
				})().catch((error: unknown) => {
					stream.close();
					for (const release of releases.values()) {
						release();
					}
					reject(error instanceof Error ? error : new Error("checks failed"));
				});
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
						databasePath,
						now: () => new Date(goodPoll),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			for (const release of releases.values()) {
				release();
			}
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("stored rows are served before the first poll ends", async () => {
		const requests: string[] = [];
		let releasePoll: () => void = () => {};
		const pollHeld = new Promise<void>((resolve) => {
			releasePoll = resolve;
		});
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const held = listedRead(input, init);
			if (held !== null && held.repo === repo) {
				pushListed(requests, held);
				await pollHeld;
				return (
					issuesResponse(input, init, [ticket(9, "2026-04-03T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const filler = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: async (input, init) => {
					const discovered = recordedDiscovery(input, init);
					if (discovered !== null) {
						return discovered;
					}
					const url = urlOf(input);
					if (url === "https://api.github.com/user") {
						return new Response(JSON.stringify({ login: "lev" }), {
							status: 200,
						});
					}
					if (listedRead(input, init)?.repo === repo) {
						return (
							issuesResponse(input, init, [
								ticket(1, "2026-04-01T00:00:00Z"),
							]) ?? page([])
						);
					}
					return recordedOrEmpty(url) ?? unrecorded(input);
				},
				readGhToken: async () => null,
				databasePath,
				now: () => new Date(goodPoll),
				listTodos: async () => "",
				waitForStop: Promise.resolve(),
			}),
		);
		expect(filler.exitCode).toBe(0);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					// The first overview read releases the list reads, so count them
					// before that read.
					expect(requests.filter((url) => listUrl(url) !== null)).toEqual([]);
					const body = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as OverviewBody;
					expect(body.projects).toEqual([
						counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
					]);
					expect(body.fetchedAt).toBe(goodPoll);
					expect(body.error).toBeNull();
					releasePoll();
					while (requests.filter((url) => listUrl(url) !== null).length < 1) {
						await Bun.sleep(20);
					}
					expect(
						requests.filter((url) => listUrl(url) !== null).length,
					).toBeGreaterThan(0);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					listTodos: async () => "",
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			releasePoll();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty store ends the running poll on the event stream when every poll fails", async () => {
		let releasePoll: () => void = () => {};
		const pollHeld = new Promise<void>((resolve) => {
			releasePoll = resolve;
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				await pollHeld;
				return discovered;
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let releaseChecks: () => void = () => {};
		const checks = new Promise<void>((resolve) => {
			releaseChecks = resolve;
		});
		let readFailure: (base: string) => Promise<void> = async () => {};
		const failed = new Promise<void>((resolve, reject) => {
			readFailure = async (base: string) => {
				try {
					const stream = openEventStream(base);
					await stream.ready;
					const events = stream.events[Symbol.asyncIterator]();
					const running = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as OverviewBody;
					expect(running.polling).toBe(true);
					expect(running.projects).toEqual([]);
					await Bun.write(path, "{\n");
					releasePoll();
					const published = await settledOverviewEvent(events, overviewOf, 8);
					stream.close();
					expect(published.polling).toBeUndefined();
					expect(published.error).toContain("invalid configuration");
					resolve();
				} catch (error) {
					reject(error instanceof Error ? error : new Error("checks failed"));
				}
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
						databasePath,
						now: () => new Date(goodPoll),
						stdout: (line) => {
							void readFailure(line);
						},
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			await failed;
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("invalid configuration");
			expect(result.listened).toBe(true);
		} finally {
			releasePoll();
			releaseChecks();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty store exits 1 when every project poll fails", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const failing: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			return new Response("recorded failure", { status: 500 });
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: failing,
					readGhToken: async () => null,
					databasePath,
					waitForStop: new Promise<void>(() => {}),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty store keeps serving when some project polls fail", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const other = listedRead(input, init);
			if (other?.repo === otherRepo) {
				return new Response("recorded failure", { status: 500 });
			}
			if (other?.repo === repo) {
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					let body: OverviewBody = {
						projects: [],
						fetchedAt: null,
						error: null,
					};
					while (body.projects.length < 2) {
						body = (await (
							await fetch(new URL("/api/overview", base))
						).json()) as OverviewBody;
						if (body.projects.length < 2) {
							await Bun.sleep(20);
						}
					}
					expect(body.projects.map((project) => project.name).sort()).toEqual([
						otherRepo,
						repo,
					]);
					const failed = body.projects.find(
						(project) => project.name === otherRepo,
					);
					expect(failed?.error).toContain("HTTP 500");
					const served = body.projects.find((project) => project.name === repo);
					expect(served?.error).toBeNull();
					expect(served?.backlog).toBe(1);
					resolve();
				})().catch(reject);
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
						databasePath,
						now: () => new Date(goodPoll),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					},
					{ first: true },
				),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a zero poll interval names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 0,
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch([]),
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pollIntervalSeconds");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a blank poll interval names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: "   ",
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch([]),
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pollIntervalSeconds");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("the event stream stays open past the idle timeout", async () => {
		// Bun checks idle sockets on a 4 second tick, so a 1 second idle timeout
		// closes an idle connection 4 seconds after its last data.
		const idleCloseMs = 4_000;
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let listening: (base: string) => void = () => {};
		const listened = new Promise<string>((resolve) => {
			listening = resolve;
		});
		const running = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: unchangedFetch([]),
				readGhToken: async () => null,
				databasePath: ":memory:",
				idleTimeoutSeconds: 1,
				stdout: (line) => listening(line),
				waitForStop: stopped,
			}),
		);
		try {
			const base = await listened;
			let closed = false;
			const socket = await Bun.connect({
				hostname: "127.0.0.1",
				port: Number(new URL(base).port),
				socket: {
					data() {},
					close() {
						closed = true;
					},
					open(open) {
						open.write(
							"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
						);
					},
				},
			});
			await Bun.sleep(idleCloseMs + 500);
			expect(closed).toBe(false);
			const probe = await fetch(new URL("/api/overview", base));
			expect(probe.status).toBe(200);
			socket.end();
		} finally {
			stop();
			const result = await running;
			await cleanup();
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		}
	});

	test("a broken configuration on refresh keeps the last overview", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const { writeFile } = await import("node:fs/promises");
					await writeFile(path, "{");
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const body = await settledOverview(base, readOverview);
					expect(body.error).toContain("not JSON");
					expect(body.projects).toEqual([
						counts(repo, 0, 0, "github", [], goodPoll),
					]);
					resolve();
				})().catch(reject);
			};
		});
		let ticks = 0;
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch(requests),
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(Date.parse(goodPoll) + ticks++ * 1_000),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
