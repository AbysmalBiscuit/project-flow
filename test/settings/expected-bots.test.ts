import { describe, expect, test } from "bun:test";

import type { Configuration } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import { fetchingBots, shown, withApp, withAppFile } from "./_support.ts";

describe("settings", () => {
	test("expected bot controls save under the repository key and change review state after a restart", async () => {
		const linear = "PLAT";
		const board = "PVT_acme_7";
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", owner: "acme", project: 7 },
				],
				expectedBots: {},
			}),
			async (base, configPath) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: {
						key: string;
						repos: string[];
						expectedBots: string[];
					}[];
				};
				const linearRow = loaded.projects.find((row) => row.key === linear);
				const boardRow = loaded.projects.find((row) => row.key === board);
				expect(linearRow?.repos).toEqual([shown]);
				expect(boardRow?.repos).toEqual([shown]);
				expect(linearRow?.expectedBots).toEqual(["grok"]);
				expect(boardRow?.expectedBots).toEqual(["grok"]);

				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: ["codex"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toEqual({ [shown]: ["codex"] });
				expect(written.expectedBots).not.toHaveProperty(linear);
				expect(written.expectedBots).not.toHaveProperty(board);
				for (const key of [linear, board]) {
					expect(
						written.projects.find((row) => row.key === key)?.expectedBots,
					).toEqual(["codex"]);
				}

				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				const reviewed = before.projects.find(
					(project) => project.name === "Shown",
				);
				const boardCard = before.projects.find(
					(project) => project.name === "Acme board",
				);
				expect(reviewed?.inReview).toBe(1);
				expect(reviewed?.awaitingMerge).toBe(0);
				expect(boardCard?.name).toBe("Acme board");
				expect(boardCard?.inReview).toBe(1);
				expect(boardCard?.awaitingMerge).toBe(0);

				await withAppFile(
					configPath,
					async (restarted) => {
						const again = (await (
							await fetch(new URL("/api/settings", restarted))
						).json()) as Configuration & {
							projects: { key: string; expectedBots: string[] }[];
						};
						expect(again.expectedBots).toEqual({ [shown]: ["codex"] });
						expect(again.expectedBots).not.toHaveProperty(linear);
						expect(again.expectedBots).not.toHaveProperty(board);
						for (const key of [linear, board]) {
							expect(
								again.projects.find((row) => row.key === key)?.expectedBots,
							).toEqual(["codex"]);
						}
						const overview = (await (
							await fetch(new URL("/api/overview", restarted))
						).json()) as Overview;
						const card = overview.projects.find(
							(project) => project.name === "Shown",
						);
						const boardAgain = overview.projects.find(
							(project) => project.name === "Acme board",
						);
						expect(card?.inReview).toBe(1);
						expect(card?.awaitingMerge).toBe(0);
						expect(boardAgain?.inReview).toBe(1);
						expect(boardAgain?.awaitingMerge).toBe(0);
					},
					async () => [],
					fetchingBots,
				);
			},
			async () => [],
			fetchingBots,
		);
	});

	test("an unknown repository leaves expected bots unavailable and unsaved", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "ORPHAN" }],
				expectedBots: {},
			}),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: { key: string; repos: string[] }[];
				};
				expect(loaded.projects.map((row) => row.key)).toEqual(["ORPHAN"]);
				const orphan = loaded.projects.find((row) => row.key === "ORPHAN");
				expect(orphan?.repos ?? []).toEqual([]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { ORPHAN: ["grok"] },
					}),
				});
				expect(saved.status).toBe(400);
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after.expectedBots ?? {}).toEqual({});
			},
			async () => [],
			(requests) => fetchingBots(requests, true),
		);
	});

	test("removing the last expected bot saves an empty override for that repository", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: { [shown]: ["grok"] },
			}),
			async (base, configPath) => {
				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(
					before.projects.find((project) => project.name === "Shown")?.inReview,
				).toBe(1);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: { key: string; repos: string[]; expectedBots: string[] }[];
				};
				const row = current.projects.find((item) => item.key === shown);
				expect(row?.repos).toEqual([shown]);
				expect(row?.expectedBots).toEqual(["grok"]);
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: [] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toEqual({ [shown]: [] });
				expect(
					written.projects.find((item) => item.key === shown)?.expectedBots,
				).toEqual([]);

				await withAppFile(
					configPath,
					async (restarted) => {
						const again = (await (
							await fetch(new URL("/api/settings", restarted))
						).json()) as Configuration & {
							projects: { key: string; expectedBots: string[] }[];
						};
						expect(again.expectedBots).toEqual({ [shown]: [] });
						expect(
							again.projects.find((item) => item.key === shown)?.expectedBots,
						).toEqual([]);
						const overview = (await (
							await fetch(new URL("/api/overview", restarted))
						).json()) as Overview;
						const card = overview.projects.find(
							(project) => project.name === "Shown",
						);
						expect(card?.inReview).toBe(0);
						expect(card?.awaitingMerge).toBe(1);
					},
					async () => [],
					fetchingBots,
				);
			},
			async () => [],
			fetchingBots,
		);
	});

	test("adding the first expected bot keeps the inferred bots for that repository", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: {},
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: {
						key: string;
						repos: string[];
						expectedBots: string[];
						repoBots: Record<string, string[]>;
					}[];
				};
				const row = current.projects.find((item) => item.key === shown);
				expect(row?.repos).toEqual([shown]);
				expect(row?.expectedBots).toEqual(["grok"]);
				expect(row?.repoBots).toEqual({ [shown]: ["grok"] });
				expect(current.expectedBots ?? {}).toEqual({});
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						expectedBots: { [shown]: ["grok", "codex"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: {
						key: string;
						expectedBots: string[];
						repoBots: Record<string, string[]>;
					}[];
				};
				expect(written.expectedBots).toEqual({ [shown]: ["grok", "codex"] });
				const shownRow = written.projects.find((item) => item.key === shown);
				expect(shownRow?.expectedBots).toEqual(["grok", "codex"]);
				expect(shownRow?.repoBots).toEqual({ [shown]: ["grok", "codex"] });
			},
			async () => [],
			fetchingBots,
		);
	});

	test("deleting an empty expected-bot override restores inferred bots", async () => {
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: shown },
					{ tracker: "linear", project: "PLAT" },
				],
				expectedBots: { [shown]: [] },
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				expect(
					current.projects &&
						Array.isArray(current.projects) &&
						current.projects.some(
							(row) =>
								typeof row === "object" &&
								row !== null &&
								"key" in row &&
								row.key === shown &&
								"expectedBots" in row &&
								Array.isArray(row.expectedBots) &&
								row.expectedBots.length === 0,
						),
				).toBe(true);
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				const { expectedBots: _bots, ...without } = configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(without),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration & {
					projects: { key: string; expectedBots: string[] }[];
				};
				expect(written.expectedBots).toBeUndefined();
				const shownRow = written.projects.find((row) => row.key === shown);
				expect(shownRow?.expectedBots).toEqual(["grok"]);
				expect(shownRow?.expectedBots).toEqual(["grok"]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(
					overview.projects.find((project) => project.name === "Shown")
						?.inReview,
				).toBe(1);
			},
			async () => [],
			fetchingBots,
		);
	});
});
