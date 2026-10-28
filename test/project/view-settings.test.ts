import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectViewSettings } from "../../src/configuration.ts";
import type { ProjectReport } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { openedView, savedProjectView } from "../../src/view-settings.ts";
import { githubFetch, githubRepo, issue, withApp } from "../project-harness.ts";
import { tempConfig, testIo } from "../support/app.ts";

describe("GET /api/projects/:name", () => {
	test("a project view that never set groupBy still opens the graph grouped by workstream", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			projectViews: {
				[githubRepo]: { openView: "board" },
			},
		});
		await withApp(
			config,
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(current.projectViews[githubRepo]?.groupBy).toBeUndefined();
				expect(
					savedProjectView(current.projectViews, githubRepo).groupBy,
				).toBeUndefined();
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							...current.projectViews,
							[githubRepo]: {
								...current.projectViews[githubRepo],
								lastView: "graph",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(written.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(written.projectViews[githubRepo]?.openView).toBe("board");
				expect(written.projectViews[githubRepo]?.groupBy).toBeUndefined();
				expect(
					savedProjectView(written.projectViews, githubRepo).groupBy,
				).toBeUndefined();
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...written,
						projectViews: {
							...written.projectViews,
							[githubRepo]: {
								...written.projectViews[githubRepo],
								groupBy: "   ",
							},
						},
					}),
				});
				expect(blank.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(kept.projectViews[githubRepo]?.groupBy).toBeUndefined();
			},
		);
	});

	test("a saved groupBy of none stays none after a Graph-tab save", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			projectViews: {
				"*": { openView: "board" },
				[githubRepo]: { groupBy: "none", search: "" },
			},
		});
		await withApp(
			config,
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, ProjectViewSettings>;
				};
				expect(current.projectViews[githubRepo]?.groupBy).toBe("none");
				expect(current.projectViews["*"]?.groupBy).toBeUndefined();
				expect(savedProjectView(current.projectViews, githubRepo).groupBy).toBe(
					"none",
				);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							...current.projectViews,
							[githubRepo]: {
								...current.projectViews[githubRepo],
								lastView: "graph",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<
						string,
						{ groupBy?: string; openView?: string; lastView?: string }
					>;
				};
				expect(written.projectViews[githubRepo]?.groupBy).toBe("none");
				expect(written.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(written.projectViews[githubRepo]?.openView).toBeUndefined();
				expect(written.projectViews["*"]?.groupBy).toBeUndefined();
			},
		);
	});

	test("a group choice writes the project view settings and survives a restart", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
		});
		const issues = [
			issue(1, "Ship the map", {
				labels: [{ name: "epic" }],
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
			issue(2, "feat(ux): draw the nodes", {
				parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/1`,
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Write the copy", {
				milestone: { title: "October" },
			}),
			issue(4, "Share the map", {
				assignees: [{ login: "Ana" }, { login: "Ben" }],
			}),
			issue(5, "Leave the draft", {}),
		];
		const reportOf = async (base: string) =>
			(await (
				await fetch(
					new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
				)
			).json()) as ProjectReport;
		let path = "";
		let cleanup = async () => {};
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const temp = await tempConfig(config);
			path = temp.path;
			cleanup = temp.cleanup;
			const start = (check: (base: string) => Promise<void>): Promise<void> => {
				let startChecks: (base: string) => void = () => {};
				const checks = new Promise<void>((resolve, reject) => {
					startChecks = (line) => {
						check(line).then(resolve).catch(reject);
					};
				});
				return run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: githubFetch(issues, []),
						readGhToken: async () => null,
						databasePath: join(root, "store.sqlite"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					}),
				).then((result) => {
					expect(result.stderr).toBe("");
					expect(result.exitCode).toBe(0);
				});
			};
			await start(async (base) => {
				const open = await reportOf(base);
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#2`),
				).toMatchObject({ workstream: "Ship the map", theme: "ux" });
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#3`),
				).toMatchObject({
					workstream: "October",
					theme: "no scope",
				});
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#3`)
						?.assignees,
				).toBeUndefined();
				const shared = open.tickets.find(
					(ticket) => ticket.key === `${githubRepo}#4`,
				)?.assignees;
				expect(shared).toContain("Ana");
				expect(shared).toContain("Ben");
				expect(shared?.some((name) => name.trim() === "")).toBe(false);
				expect(
					open.tickets.find((ticket) => ticket.key === `${githubRepo}#5`)
						?.assignees,
				).toBeUndefined();
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(current.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { groupBy: "workstream" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(written.projectViews[githubRepo]?.groupBy).toBe("workstream");
				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { groupBy: "lane" },
						},
					}),
				});
				expect(rejected.status).toBe(400);
				const named = (await rejected.json()) as { error: string };
				expect(named.error).toContain("groupBy");
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(kept.projectViews[githubRepo]?.groupBy).toBe("workstream");
			});
			await start(async (base) => {
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { groupBy?: string }>;
				};
				expect(again.projectViews[githubRepo]?.groupBy).toBe("workstream");
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...again,
						projectViews: {
							[githubRepo]: { groupBy: "   " },
						},
					}),
				});
				expect(blank.status).toBe(400);
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a filter change writes the project view settings and survives a restart", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
		});
		const issues = [
			issue(1, "Ship the map", {
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
			issue(2, "Draw the legend", {
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Old done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-01T12:00:00.000Z",
			}),
			issue(4, "Recent done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "cy" },
				assignees: [{ login: "cy" }],
				updated_at: "2026-08-17T12:00:00.000Z",
			}),
			issue(5, "Dropped the draft", {
				state: "closed",
				state_reason: "not_planned",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
		];
		const keys = async (base: string) => {
			const report = (await (
				await fetch(
					new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
				)
			).json()) as ProjectReport;
			return {
				lanes: report.lanes.map((lane) => lane.name),
				tickets: report.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [ticket.key],
				),
			};
		};
		let path = "";
		let cleanup = async () => {};
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const temp = await tempConfig(config);
			path = temp.path;
			cleanup = temp.cleanup;
			const start = (check: (base: string) => Promise<void>): Promise<void> => {
				let startChecks: (base: string) => void = () => {};
				const checks = new Promise<void>((resolve, reject) => {
					startChecks = (line) => {
						check(line).then(resolve).catch(reject);
					};
				});
				return run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: githubFetch(issues, []),
						readGhToken: async () => null,
						databasePath: join(root, "store.sqlite"),
						now: () => new Date("2026-08-18T12:00:00.000Z"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					}),
				).then((result) => {
					expect(result.stderr).toBe("");
					expect(result.exitCode).toBe(0);
				});
			};
			await start(async (base) => {
				const open = await keys(base);
				expect(open.lanes).toContain("Done");
				expect(open.lanes).toContain("Dropped");
				expect(open.tickets).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
					`${githubRepo}#4`,
					`${githubRepo}#40`,
				]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, Record<string, unknown>>;
				};
				expect(current.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								shownLanes: ["Backlog", "Done"],
								maxAgeDays: { Done: 2, Backlog: 0 },
								needsYouOnly: false,
								blockedOnly: false,
								assignees: ["ada", "cy"],
								search: "done",
								openView: "table",
								graphDirection: "top-to-bottom",
								groupBy: "none",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(written.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					withRunsOnly: false,
					latestRunOnly: false,
					runStatuses: [],
					runResults: [],
					runFactories: [],
					openView: "table",
					graphDirection: "top-to-bottom",
					graphLayout: "layered",
					groupBy: "none",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
			await start(async (base) => {
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(again.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					withRunsOnly: false,
					latestRunOnly: false,
					runStatuses: [],
					runResults: [],
					runFactories: [],
					openView: "table",
					graphDirection: "top-to-bottom",
					graphLayout: "layered",
					groupBy: "none",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a saved filter keeps each ticket's update time", async () => {
		const calls: string[] = [];
		const issues = [
			issue(1, "Ship the map", { updated_at: "2026-08-18T09:00:00.000Z" }),
			issue(2, "Draw the legend", {
				updated_at: "2026-08-12T09:00:00.000Z",
				assignee: { login: "bea" },
			}),
			issue(3, "Hold the map copy", { updated_at: "2026-08-18T15:00:00.000Z" }),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: {
						search: "map",
						needsYouOnly: false,
						blockedOnly: false,
					},
				},
			}),
			githubFetch(issues, [], calls),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.map((ticket) => ({
						key: ticket.key,
						updatedAt: ticket.updatedAt,
					})),
				).toEqual([
					{
						key: `${githubRepo}#1`,
						updatedAt: "2026-08-18T09:00:00.000Z",
					},
					{
						key: `${githubRepo}#3`,
						updatedAt: "2026-08-18T15:00:00.000Z",
					},
				]);
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo: githubRepo }],
						projectViews: {
							[githubRepo]: { search: "   " },
						},
					}),
				});
				expect(blank.status).toBe(200);
				const cleared = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(cleared.tickets.map((ticket) => ticket.updatedAt)).toEqual([
					"2026-08-18T09:00:00.000Z",
					"2026-08-12T09:00:00.000Z",
					"2026-08-18T15:00:00.000Z",
				]);
			},
		);
	});

	test("last opens the saved view, and a pinned view stays pinned", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([issue(1, "Ship the map")]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const settingsUrl = new URL("/api/settings", base);
				const projectUrl = new URL(
					`/api/projects/${encodeURIComponent(githubRepo)}`,
					base,
				);
				const readSettings = async () =>
					(await (await fetch(settingsUrl)).json()) as {
						projectViews: Record<string, ProjectViewSettings>;
					};
				const reopen = async () => {
					const opened = await fetch(projectUrl);
					expect(opened.status).toBe(200);
					const report = (await opened.json()) as ProjectReport;
					expect(report).not.toHaveProperty("openView");
					expect(report.name).toBe(githubRepo);
					return readSettings();
				};

				const current = await readSettings();
				expect(current.projectViews["*"]?.openView).toBeUndefined();
				expect(current.projectViews[githubRepo]?.lastView).toBeUndefined();

				const last = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "last" },
						},
					}),
				});
				expect(last.status).toBe(200);
				const savedLast = await readSettings();
				expect(savedLast.projectViews["*"]?.openView).toBe("last");

				const switched = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...savedLast,
						projectViews: {
							"*": { openView: "last" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(switched.status).toBe(200);
				const reopened = await reopen();
				expect(reopened.projectViews["*"]?.openView).toBe("last");
				expect(reopened.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(reopened.projectViews[githubRepo]?.openView).toBeUndefined();

				const pinned = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...reopened,
						projectViews: {
							"*": { openView: "board" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(pinned.status).toBe(200);
				const savedBoard = await reopen();
				expect(savedBoard.projectViews["*"]?.openView).toBe("board");
				expect(savedBoard.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(savedBoard.projectViews[githubRepo]?.openView).toBeUndefined();

				const switchedAgain = await fetch(settingsUrl, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...savedBoard,
						projectViews: {
							"*": { openView: "board" },
							[githubRepo]: { lastView: "graph" },
						},
					}),
				});
				expect(switchedAgain.status).toBe(200);
				const stayed = await reopen();
				expect(stayed.projectViews["*"]?.openView).toBe("board");
				expect(stayed.projectViews[githubRepo]?.lastView).toBe("graph");
				expect(stayed.projectViews[githubRepo]?.openView).toBeUndefined();
			},
		);
	});

	test("a project opens in the star's open view, even with an open view of its own", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(report).not.toHaveProperty("openView");
				const opened = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				expect(
					savedProjectView(opened.projectViews ?? {}, githubRepo).openView,
				).toBe("graph");
				const own = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
							[githubRepo]: {
								openView: "board",
								lastView: "table",
								search: "",
							},
						},
					}),
				});
				expect(own.status).toBe(200);
				const won = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(won).not.toHaveProperty("openView");
				const ownSettings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				const ownView = savedProjectView(
					ownSettings.projectViews ?? {},
					githubRepo,
				);
				expect(ownView.openView).toBe("graph");
				expect(openedView(ownView)).toBe("graph");
				const spaced = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph", search: "   " },
						},
					}),
				});
				expect(spaced.status).toBe(200);
				const kept = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(kept).not.toHaveProperty("openView");
				const keptSettings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews?: Record<string, ProjectViewSettings>;
				};
				expect(
					savedProjectView(keptSettings.projectViews ?? {}, githubRepo)
						.openView,
				).toBe("graph");
			},
		);
	});
});
