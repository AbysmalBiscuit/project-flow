import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { projectBoard } from "../review-board.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { repo } from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import { progress } from "./_support.ts";

describe("review cycle", () => {
	test("a workcell progress comment on a GitHub project ticket keeps its PR in review", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report on a GitHub project ticket sets its PR to awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
			{
				body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
				user: null,
			},
		]);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						tracker: "github",
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a final report listed after the progress comment sets awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const progressBody = progress(
			"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
		);
		const reportBody =
			"Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->";
		const board = projectBoard([{ number: 83 }], undefined, [
			{ body: progressBody, user: null },
			{ body: reportBody, user: null },
		]);
		const commentReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (
				url ===
				`https://api.github.com/repos/${repo}/issues/8/comments?per_page=100&page=1`
			) {
				commentReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						inReview: 0,
						awaitingMerge: 1,
						tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
					},
				],
			});
			expect(commentReads.length).toBeGreaterThan(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closing PR past the first page takes the workcell review state", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const earlier = Array.from({ length: 20 }, (_item, index) => ({
			number: index + 1,
			repository: { nameWithOwner: repo },
		}));
		const board = projectBoard(
			[],
			[
				{ nodes: earlier, endCursor: "closing-2" },
				{
					nodes: [{ number: 83, repository: { nameWithOwner: repo } }],
					endCursor: null,
				},
			],
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
					),
					user: null,
				},
			],
		);
		const pullReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const pullMatch = url.match(/\/pulls\/(\d+)$/);
			if (pullMatch?.[1] !== undefined) {
				pullReads.push(pullMatch[1]);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
			expect(pullReads).toContain("83");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a rejected GitHub project list is sent again on the next poll", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let projectReads = 0;
		let rejectNext = false;
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (
				urlOf(input) === "https://api.github.com/graphql" &&
				sent.includes("node(id:") &&
				!sent.includes("ProjectFields")
			) {
				projectReads += 1;
				if (rejectNext) {
					rejectNext = false;
					return new Response("recorded failure", { status: 500 });
				}
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const seeded = await fetch(new URL("/api/overview", base));
						expect(seeded.status).toBe(200);
						expect(await seeded.json()).toMatchObject({
							projects: [{ name: "Widget board", error: null }],
						});
						rejectNext = true;
						const failed = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(failed.status).toBe(204);
						const first = await settledOverview(base, async (url) => {
							const response = await fetch(new URL("/api/overview", url));
							expect(response.status).toBe(200);
							return (await response.json()) as {
								projects: { error: string | null }[];
								polling?: true;
							};
						});
						expect(first).toMatchObject({
							projects: [
								{
									name: "Widget board",
									error:
										"GitHub list project tickets failed (HTTP 500): PVT_widget (stale since 2026-10-18T12:00:00.000Z)",
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const second = await settledOverview(base, async (url) => {
							const response = await fetch(new URL("/api/overview", url));
							expect(response.status).toBe(200);
							return (await response.json()) as {
								projects: { error: string | null }[];
								polling?: true;
							};
						});
						expect(second).toMatchObject({
							projects: [
								{
									name: "Widget board",
									tracker: "github",
									inReview: 1,
									awaitingMerge: 0,
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(projectReads).toBe(3);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a second poll reads a progress comment added to the board", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const quiet = projectBoard([{ number: 83 }]);
		const progressed = projectBoard([{ number: 83 }], undefined, [
			{
				body: progress(
					"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
				),
				user: null,
			},
		]);
		let projectReads = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const sent = typeof init?.body === "string" ? init.body : "";
			if (
				urlOf(input) === "https://api.github.com/graphql" &&
				sent.includes("ProjectItems")
			) {
				projectReads += 1;
			}
			return projectReads <= 1 ? quiet(input, init) : progressed(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const firstResponse = await fetch(new URL("/api/overview", base));
						expect(firstResponse.status).toBe(200);
						expect(await firstResponse.json()).toMatchObject({
							projects: [
								{
									name: "Widget board",
									inReview: 0,
									awaitingMerge: 1,
									tickets: [{ key: `${repo}#8`, state: "awaitingMerge" }],
								},
							],
						});
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						let second: {
							projects?: { inReview?: number; polling?: true }[];
							polling?: true;
						} = {};
						while (second.projects?.[0]?.inReview !== 1) {
							const secondResponse = await fetch(
								new URL("/api/overview", base),
							);
							expect(secondResponse.status).toBe(200);
							second = (await secondResponse.json()) as typeof second;
							if (second.projects?.[0]?.inReview !== 1) {
								await Bun.sleep(20);
							}
						}
						expect(second).toMatchObject({
							projects: [
								{
									name: "Widget board",
									inReview: 1,
									awaitingMerge: 0,
									tickets: [{ key: `${repo}#8`, state: "inReview" }],
								},
							],
						});
					})(),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(projectReads).toBe(2);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a closing pull in another repository still takes the workcell review state", async () => {
		const other = "acme/other";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [], [other]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard(
			[{ number: 83, repo: other }],
			[
				{
					nodes: [{ number: 83, repository: { nameWithOwner: other } }],
					endCursor: null,
				},
			],
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/other/pull/83",
					),
					user: null,
				},
			],
		);
		const pullReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.includes(`/repos/${other}/pulls/`)) {
				pullReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 1,
						awaitingMerge: 0,
						tickets: [{ key: `${repo}#8`, state: "inReview" }],
					},
				],
			});
			expect(pullReads).toContain(
				`https://api.github.com/repos/${other}/pulls/83`,
			);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("two tickets closed by one pull both take the workcell review state", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const progressBody = progress(
			"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
		);
		const board = projectBoard(
			[{ number: 83 }],
			undefined,
			[{ body: progressBody, user: null }],
			[
				{
					id: "I_widget_9",
					number: 9,
					title: "Ticket 9",
					pulls: [{ number: 83 }],
					comments: [{ body: progressBody, user: null }],
				},
			],
		);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: board,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						name: "Widget board",
						inReview: 2,
						awaitingMerge: 0,
						tickets: [
							{ key: `${repo}#8`, state: "inReview" },
							{ key: `${repo}#9`, state: "inReview" },
						],
					},
				],
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a board ticket with no open pull skips its comment read", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 7 }],
				expectedBots: { [repo]: [] },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const board = projectBoard(
			[{ number: 83 }],
			undefined,
			[
				{
					body: progress(
						"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83",
					),
					user: null,
				},
			],
			[
				{
					id: "I_widget_9",
					number: 9,
					title: "Ticket 9",
					pulls: [],
					comments: [{ body: "no pull here", user: null }],
				},
			],
		);
		const commentReads: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.includes("/issues/") && url.includes("/comments")) {
				commentReads.push(url);
			}
			return board(input, init);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<unknown>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve(await response.json());
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
			expect(await checks).toMatchObject({
				projects: [
					{
						inReview: 1,
						tickets: [
							{ key: `${repo}#8`, state: "inReview" },
							{ key: `${repo}#9`, state: "backlog" },
						],
					},
				],
			});
			expect(
				commentReads.some((url) => url.includes("/issues/8/comments")),
			).toBe(true);
			expect(
				commentReads.some((url) => url.includes("/issues/9/comments")),
			).toBe(false);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
