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
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import {
	assertCard,
	emptyList,
	githubFetch,
	githubTicket,
} from "./_support.ts";

describe("GET /api/overview", () => {
	test("a GitHub list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
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
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: failing,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a later poll drops a repo that is no longer pinned", async () => {
		const repoA = "acme/alpha";
		const repoB = "acme/beta";
		const requests: string[] = [];
		const recordedFetch =
			(pinned: string): Fetch =>
			async (input, init) => {
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
				if (url === "https://api.linear.app/graphql") {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{ status: 200 },
					);
				}
				const list = new URL(url);
				if (
					list.origin === "https://api.github.com" &&
					list.pathname === `/repos/${pinned}/issues`
				) {
					requests.push(url);
					return page([githubTicket(1, "open", null)], null);
				}
				if (
					url.includes("/pulls?") ||
					url.includes("/branches?") ||
					url.includes("/labels?") ||
					url.includes("/comments") ||
					url.includes("/reviews") ||
					url.includes("/reactions") ||
					url.includes("/commits/") ||
					url.includes("/check-runs")
				) {
					return url.includes("/check-runs")
						? new Response(JSON.stringify({ check_runs: [] }), { status: 200 })
						: url.includes("/commits/")
							? Response.json({ commit: { committer: { date: null } } })
							: page([], null);
				}
				return (
					emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
				);
			};
		const store = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(store, "project-flow.sqlite");
		const serve = async (
			pinned: string,
			refresh: boolean,
		): Promise<unknown> => {
			const { path, cleanup } = await tempConfig(
				JSON.stringify({
					pinned: [{ tracker: "github", repo: pinned }],
				}),
			);
			let startChecks: (base: string) => void = () => {};
			const checks = new Promise<unknown>((resolve, reject) => {
				startChecks = (base: string) => {
					void (async () => {
						if (refresh) {
							const posted = await fetch(new URL("/api/refresh", base), {
								method: "POST",
							});
							expect(posted.status).toBe(204);
						}
						const body = await settledOverview(base, async (url) => {
							const response = await fetch(new URL("/api/overview", url));
							expect(response.status).toBe(200);
							return (await response.json()) as Overview;
						});
						resolve(body);
					})().catch(reject);
				};
			});
			try {
				const result = await run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: {
							GITHUB_TOKEN: "recorded-token",
							LINEAR_API_KEY: "recorded-linear-key",
						},
						fetch: recordedFetch(pinned),
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
						waitForStop: checks.then(() => undefined),
					}),
				);
				expect(result.stderr).toBe("");
				expect(result.exitCode).toBe(0);
				expect(result.listened).toBe(true);
				return await checks;
			} finally {
				await cleanup();
			}
		};
		try {
			const first = (await serve(repoA, false)) as Overview;
			expect(first).toEqual({
				projects: [
					{
						name: repoA,
						tracker: "github",
						ref: { tracker: "github", repo: repoA },
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: `${repoA}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: first.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: first.fetchedAt,
				error: null,
			});
			const before = requests.length;
			const second = (await serve(repoB, true)) as Overview;
			expect(second.projects.map((project) => project.name)).toEqual([repoB]);
			expect(second).toEqual({
				projects: [
					{
						name: repoB,
						tracker: "github",
						ref: { tracker: "github", repo: repoB },
						done: 0,
						dropped: 0,
						blocked: 0,
						backlog: 1,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: `${repoB}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-10-18T12:00:00.000Z",
								updatedAt: "2026-10-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 0,
						fetchedAt: second.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 1,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 0,
							dropped: 0,
						},
					},
				],
				fetchedAt: second.fetchedAt,
				error: null,
			});
			const beta = requests
				.slice(before)
				.filter((url) => url.includes(`/repos/${repoB}/issues`));
			expect(new URL(beta[0] ?? "").searchParams.get("since")).toBeNull();
		} finally {
			await rm(store, { recursive: true, force: true });
		}
	});

	test("a project with no open tickets stays off the overview", async () => {
		const closedRepo = "acme/closed";
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const closedOnly: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: closedRepo,
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/issues?")) {
				return page(
					[
						{
							number: 1,
							title: "Done",
							state: "closed",
							state_reason: "completed",
							updated_at: "2026-10-18T12:00:00.000Z",
						},
					],
					null,
				);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (
				url === "https://api.linear.app/graphql" &&
				body.includes("projects(")
			) {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			return (
				emptyList(url) ?? emptyProjectFields(input, init) ?? unrecorded(input)
			);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: closedOnly,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const empty = (await checks) as Overview;
			expect(empty).toEqual({
				projects: [],
				fetchedAt: empty.fetchedAt,
				error: null,
				tracked: false,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an open ask counts as needs you, and a quoted ask does not", async () => {
		const ask = "<!-- workcell:ask 11-1 -->";
		const quiet = "acme/quiet";
		const asked = "acme/asked";
		function issue(
			number: number,
			state: "open" | "closed",
		): Record<string, unknown> {
			return {
				number,
				title: `Ticket ${number}`,
				state,
				state_reason: state === "closed" ? "completed" : null,
				updated_at: "2026-10-18T12:00:00Z",
				body: "",
			};
		}
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
					},
				);
			}
			const quietList = `https://api.github.com/repos/${quiet}/issues?`;
			const askedList = `https://api.github.com/repos/${asked}/issues?`;
			if (url.startsWith(quietList)) {
				return page(
					[issue(1, "closed"), issue(2, "closed"), issue(3, "open")],
					null,
				);
			}
			if (url.startsWith(askedList)) {
				return page(
					[
						{ ...issue(1, "open"), comments: 1 },
						{ ...issue(2, "open"), comments: 2 },
						{ ...issue(3, "open"), comments: 2 },
						{ ...issue(4, "open"), comments: 1 },
						{ ...issue(7, "closed"), comments: 1 },
						issue(8, "open"),
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/1/comments`)) {
				return page([{ body: `This waits on Lev.\n\n${ask}` }], null);
			}
			if (url.includes(`/repos/${asked}/issues/2/comments`)) {
				return page(
					[
						{ body: `This waits on Lev.\n\n${ask}` },
						{ body: "Use the short name.\n\n11-1" },
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/3/comments`)) {
				return page(
					[
						{ body: `This waits on Lev.\n\n${ask}` },
						{ body: "See 11-12 for the later ask." },
					],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/4/comments`)) {
				return page(
					[{ body: "Lev asked yesterday. The passphrase is in the vault." }],
					null,
				);
			}
			if (url.includes(`/repos/${asked}/issues/7/comments`)) {
				return page([{ body: `This waits on Lev.\n\n${ask}` }], null);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([], null);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: quiet },
					{ tracker: "github", repo: asked },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const requests: string[] = [];
		const fetching: Fetch = async (input, init) => {
			requests.push(urlOf(input));
			return recorded(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetching,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as {
				projects: { name: string; needsYou: number; progress: number }[];
			};
			expect(
				body.projects.find((project) => project.name === quiet),
			).toMatchObject({ needsYou: 0, progress: 67 });
			expect(
				body.projects.find((project) => project.name === asked),
			).toMatchObject({ needsYou: 2, progress: 17 });
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a recorded issue list with comments as a number still serves overview", async () => {
		const ask = "<!-- workcell:ask 11-2 -->";
		const listed = "acme/listed";
		const commentBody = `This waits on Lev.\n\n${ask}`;
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								organizations: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					}),
					{ status: 200 },
				);
			}
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{ status: 200 },
				);
			}
			const list = `https://api.github.com/repos/${listed}/issues?`;
			if (url.startsWith(list)) {
				return page(
					[
						{
							number: 3,
							title: "Counted comments",
							state: "open",
							state_reason: null,
							updated_at: "2026-10-18T12:00:00Z",
							body: "",
							comments: 3,
						},
					],
					null,
				);
			}
			if (url.includes("/issues/3/comments")) {
				return page(
					[
						{ body: "Earlier note." },
						{ body: commentBody },
						{ body: "Still waiting." },
					],
					null,
				);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return page([], null);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo: listed }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => resolve(await response.json()))
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const body = (await checks) as {
				projects: { name: string; needsYou: number }[];
			};
			expect(
				body.projects.find((project) => project.name === listed),
			).toMatchObject({ needsYou: 1 });
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("counts done, dropped and backlog from recorded GitHub tickets", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "missing", "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				assertCard(base).then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: githubFetch(requests),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(result.listened).toBe(true);
			expect(await Bun.file(databasePath).exists()).toBe(true);
			expect(requests.some((url) => url.includes("/issues?"))).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an omitted poll interval is 300 seconds", async () => {
		const { path, cleanup } = await tempConfig("{}");
		const root = await mkdtemp(join(tmpdir(), "project-flow-poll-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const response = await fetch(new URL("/api/settings", base));
					expect(response.status).toBe(200);
					const settings = (await response.json()) as {
						pollIntervalSeconds: number;
					};
					expect(settings.pollIntervalSeconds).toBe(300);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: async () => new Response("not recorded", { status: 404 }),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
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

	test("an overview request returns 200 while another connection holds a write", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
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
				"github:acme/widget",
				"acme/widget",
				"github",
				JSON.stringify({
					tickets: [],
					pulls: [],
					branches: [],
					startedKeys: [],
				}),
			);
		seeded.close();
		let releaseTracker: () => void = () => {};
		const trackerHeld = new Promise<void>((resolve) => {
			releaseTracker = resolve;
		});
		const writer = new Database(databasePath);
		let held = false;
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					writer.run("begin exclusive");
					held = true;
					const response = await fetch(new URL("/api/overview", base));
					writer.run("rollback");
					held = false;
					expect(response.status).toBe(200);
					const body = (await response.json()) as {
						projects: { name: string }[];
						error: string | null;
					};
					expect(body.error).toBeNull();
					expect(body.projects.map((project) => project.name)).toEqual([
						"acme/widget",
					]);
					releaseTracker();
					resolve();
				})().catch((error: unknown) => {
					releaseTracker();
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
							await trackerHeld;
							if (url.includes(`/repos/${repo}/issues?`)) {
								return page([githubTicket(5, "open", null)], null);
							}
							return emptyList(url) ?? unrecorded(input);
						},
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
			releaseTracker();
			if (held) {
				writer.run("rollback");
			}
			writer.close();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
