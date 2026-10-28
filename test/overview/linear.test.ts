import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview, ProjectCounts } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	linearFetch,
	linearIssue,
	linearName,
	linearProject,
} from "./_support.ts";

describe("GET /api/overview", () => {
	test("a missing Linear key serves and names LINEAR_API_KEY on the pinned project", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-overview-"));
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
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "   " },
					fetch: linearFetch([]),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.listened).toBe(true);
			const body = await checks;
			expect(body.projects[0]?.error).toContain("LINEAR_API_KEY");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank Linear project slug names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "   " }],
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFetch([]),
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pinned.0.project");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a rejected Linear key does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-overview-"));
		const rejected = linearFake({ fail: "key" });
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "rejected-key",
					},
					fetch: rejected,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("LINEAR_API_KEY");
			expect(result.stderr).toContain("401");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an unknown Linear state type does not count as a ticket", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const unknown = linearFake({
			project: {
				id: "project-1",
				name: linearName,
				slugId: linearProject,
			},
			issues: [
				linearIssue("1", "completed"),
				{
					id: "9",
					identifier: "WID-9",
					updatedAt: "2026-04-01T00:00:00.000Z",
					state: { type: "archived-mystery" },
				},
				{
					id: "10",
					identifier: "WID-10",
					updatedAt: "2026-04-01T00:00:00.000Z",
					state: null,
				},
			],
		});
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
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: unknown,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			const body = (await checks) as Overview;
			expect(body).toEqual({
				projects: [
					{
						name: linearName,
						tracker: "linear",
						ref: { tracker: "linear", project: linearProject },
						done: 1,
						dropped: 0,
						blocked: 0,
						backlog: 0,
						inProgress: 0,
						inReview: 0,
						awaitingMerge: 0,
						tags: [],
						unlinkedPrs: [],
						tickets: [
							{
								key: "WID-1",
								title: "Linear ticket 1",
								state: "done",
								blockers: [],
								lane: "Done",
								statusType: "done",
								enteredStateAt: "2026-08-18T12:00:00.000Z",
								updatedAt: "2026-08-18T12:00:00.000Z",
							},
						],
						crossProjectBlockers: [],
						needsYou: 0,
						progress: 100,
						fetchedAt: body.projects[0]?.fetchedAt ?? null,
						error: null,
						statusTypes: {
							backlog: 0,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							done: 1,
							dropped: 0,
						},
					},
				],
				fetchedAt: body.fetchedAt,
				error: null,
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a Linear pin that matches no project stops startup and names the pin", async () => {
		const pin = "agent-docs-cleanup";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const unmatched = linearFake({ project: null });
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: unmatched,
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain(pin);
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a Linear project lookup failure stops startup and names the pin", async () => {
		const pin = "widget-launch";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const failing = linearFake({ fail: "lookup", status: 502 });
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
			expect(result.stderr).toContain(pin);
			expect(result.stderr).toContain("HTTP 502");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
		}
	});

	test("a Linear list failure does not serve an overview", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
			}),
		);
		const failing = linearFake({
			project: {
				id: "project-1",
				name: linearName,
				slugId: linearProject,
			},
			fail: "issues",
		});
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

	test("a Linear card heading shows the Linear project name", async () => {
		const pin = "agent-docs-cleanup-0d42ae5d46d0";
		const projectName = "Agent docs cleanup";
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: pin }],
			}),
		);
		const named = linearFake({
			project: {
				id: "project-1",
				name: projectName,
				slugId: pin,
			},
			issues: [linearIssue("1", "completed")],
		});
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
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: named,
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.exitCode).toBe(0);
			const overview = (await checks) as {
				projects: { name: string; tracker: string }[];
			};
			expect(overview.projects[0]?.name).toBe(projectName);
			expect(overview.projects[0]?.name).not.toContain(pin);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("counts done, dropped and backlog from recorded Linear tickets", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "linear", project: linearProject },
				],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/overview", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const body = (await response.json()) as {
							projects: ProjectCounts[];
							error: string | null;
						};
						expect(body.projects).toHaveLength(2);
						const github = body.projects.find(
							(project) => project.tracker === "github",
						);
						expect(github).toEqual({
							name: repo,
							tracker: "github",
							ref: { tracker: "github", repo },
							done: 2,
							dropped: 2,
							blocked: 0,
							backlog: 2,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							tags: [],
							unlinkedPrs: [],
							tickets: [
								{
									key: `${repo}#1`,
									title: "Ticket 1",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#2`,
									title: "Ticket 2",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#3`,
									title: "Ticket 3",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#4`,
									title: "Ticket 4",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#5`,
									title: "Ticket 5",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-10-18T12:00:00.000Z",
									updatedAt: "2026-10-18T12:00:00.000Z",
								},
								{
									key: `${repo}#6`,
									title: "Ticket 6",
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
							progress: 33,
							fetchedAt: github?.fetchedAt ?? null,
							error: null,
							statusTypes: {
								backlog: 2,
								inProgress: 0,
								inReview: 0,
								awaitingMerge: 0,
								done: 2,
								dropped: 2,
							},
						});
						const linear = body.projects.find(
							(project) => project.tracker === "linear",
						);
						expect(linear).toEqual({
							name: linearName,
							tracker: "linear",
							ref: { tracker: "linear", project: linearProject },
							done: 2,
							dropped: 2,
							blocked: 0,
							backlog: 2,
							inProgress: 0,
							inReview: 0,
							awaitingMerge: 0,
							tags: [],
							unlinkedPrs: [],
							tickets: [
								{
									key: "WID-1",
									title: "Linear ticket 1",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-2",
									title: "Linear ticket 2",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-3",
									title: "Linear ticket 3",
									state: "dropped",
									blockers: [],
									lane: "Dropped",
									statusType: "dropped",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-4",
									title: "Linear ticket 4",
									state: "done",
									blockers: [],
									lane: "Done",
									statusType: "done",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-5",
									title: "Linear ticket 5",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
								{
									key: "WID-6",
									title: "Linear ticket 6",
									state: "backlog",
									blockers: [],
									lane: "Backlog",
									statusType: "backlog",
									enteredStateAt: "2026-08-18T12:00:00.000Z",
									updatedAt: "2026-08-18T12:00:00.000Z",
								},
							],
							crossProjectBlockers: [],
							needsYou: 0,
							progress: 33,
							fetchedAt: linear?.fetchedAt ?? null,
							error: null,
							statusTypes: {
								backlog: 2,
								inProgress: 0,
								inReview: 0,
								awaitingMerge: 0,
								done: 2,
								dropped: 2,
							},
						});
						expect(body.error).toBeNull();
						resolve();
					})
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
					fetch: linearFetch(requests),
					readGhToken: async () => null,
					databasePath,
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			expect(requests.length).toBeGreaterThan(0);
			const sent = requests.map(
				(body) => JSON.parse(body) as { query: string; variables: unknown },
			);
			expect(sent.every((call) => call.query.includes("state"))).toBe(true);
			expect(sent.slice(0, 2).map((call) => call.variables)).toEqual([
				{
					filter: { project: { id: { eq: "project-1" } } },
					after: null,
				},
				{
					filter: { project: { id: { eq: "project-1" } } },
					after: "page-2",
				},
			]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
