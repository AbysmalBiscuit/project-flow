import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Configuration } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import {
	checkoutFor,
	fetching,
	quiet,
	savedRepo,
	savedRoot,
	shown,
	withApp,
	withAppFile,
} from "./_support.ts";

describe("settings", () => {
	test("a tracked github owner/project shows on the overview and a settings write round-trips it", async () => {
		const pin = { tracker: "github" as const, owner: "acme", project: 7 };
		const repo = { tracker: "github" as const, repo: shown };
		await withApp(JSON.stringify({ tracked: [pin, repo] }), async (base) => {
			const onBoard = (overview: Overview) =>
				overview.projects.find(
					(item) =>
						item.ref.tracker === "github" &&
						"owner" in item.ref &&
						item.ref.owner === pin.owner &&
						item.ref.project === pin.project,
				);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(overview)?.ref).toEqual(pin);

			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const removed = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, tracked: [repo] }),
			});
			expect(removed.status).toBe(200);
			expect(((await removed.json()) as Configuration).tracked).toEqual([repo]);
			const untracked = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(untracked)).toBeUndefined();

			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const restored = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...current, tracked: [repo, pin] }),
			});
			expect(restored.status).toBe(200);
			const written = (await restored.json()) as Configuration;
			expect(written.tracked).toEqual([repo, pin]);
			const reread = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(reread.tracked).toEqual([repo, pin]);
			const after = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(onBoard(after)?.ref).toEqual(pin);
		});
	});

	test("settings names a missing tracker credential and keeps the token out", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-settings-"));
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const requests: string[] = [];
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				fetch(new URL("/api/settings", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						const body = (await response.json()) as {
							trackers: { github: boolean; linear: boolean };
						};
						expect(body.trackers).toEqual({ github: false, linear: false });
						resolve();
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: fetching(requests),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
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

	test("a blank settings body names the configuration and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: "   ",
			});
			expect(saved.status).toBe(400);
			const body = (await saved.json()) as { error: string };
			expect(body.error).toContain("configuration");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("settings lists every found and tracked project with its tracker and source", async () => {
		const pinnedOnly = "acme/pinned-only";
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "github", repo: quiet },
					{ tracker: "github", repo: pinnedOnly },
				],
				pmBot: { [shown]: false },
				expectedBots: { [shown]: ["grok", "codex"] },
			}),
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projects: {
						name: string;
						key: string;
						tracker: string;
						source: string;
						tracked: boolean;
						pmBot: boolean;
						expectedBots: string[];
						ref: unknown;
					}[];
				};
				const rows = [...body.projects].sort((left, right) =>
					left.key.localeCompare(right.key),
				);
				expect(rows.map((row) => row.key)).toEqual([
					savedRepo,
					pinnedOnly,
					quiet,
					shown,
				]);
				const byKey = new Map(rows.map((row) => [row.key, row]));
				expect(byKey.get(shown)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: false,
					pmBot: false,
					expectedBots: ["grok", "codex"],
					ref: { tracker: "github", repo: shown },
				});
				expect(byKey.get(quiet)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: true,
				});
				expect(byKey.get(pinnedOnly)).toMatchObject({
					tracker: "github",
					source: "configured",
					tracked: true,
					ref: { tracker: "github", repo: pinnedOnly },
				});
				expect(byKey.get(savedRepo)).toMatchObject({
					tracker: "github",
					source: "found",
					tracked: false,
				});
			},
			async () => [checkoutFor(savedRoot)],
		);
	});

	test("switch and bot changes save and survive a restart", async () => {
		await withApp(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: shown }],
				pmBot: {},
				expectedBots: {},
			}),
			async (base, configPath) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown[];
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...configuration
				} = current;
				expect(
					current.projects.some(
						(row) =>
							typeof row === "object" &&
							row !== null &&
							"key" in row &&
							row.key === shown,
					),
				).toBe(true);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configuration,
						tracked: [{ tracker: "github", repo: quiet }],
						baselineTracked: configuration.tracked,
						pmBot: { [quiet]: false, [shown]: true },
						expectedBots: { [quiet]: ["codex"], [shown]: ["grok"] },
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projects: {
						key: string;
						tracked: boolean;
						pmBot: boolean;
						expectedBots: string[];
					}[];
				};
				const quietRow = written.projects.find((row) => row.key === quiet);
				const shownRow = written.projects.find((row) => row.key === shown);
				expect(quietRow).toMatchObject({
					tracked: true,
					pmBot: false,
					expectedBots: ["codex"],
				});
				expect(shownRow).toMatchObject({
					tracked: false,
					pmBot: true,
					expectedBots: ["grok"],
				});

				await withAppFile(configPath, async (restarted) => {
					const again = (await (
						await fetch(new URL("/api/settings", restarted))
					).json()) as {
						tracked: unknown;
						pmBot: unknown;
						expectedBots: unknown;
						projects: {
							key: string;
							tracked: boolean;
							pmBot: boolean;
							expectedBots: string[];
						}[];
					};
					expect(again.tracked).toEqual([{ tracker: "github", repo: quiet }]);
					expect(again.pmBot).toEqual({ [quiet]: false, [shown]: true });
					expect(again.expectedBots).toEqual({
						[quiet]: ["codex"],
						[shown]: ["grok"],
					});
					expect(again.projects.find((row) => row.key === quiet)).toMatchObject(
						{
							tracked: true,
							pmBot: false,
							expectedBots: ["codex"],
						},
					);
					expect(again.projects.find((row) => row.key === shown)).toMatchObject(
						{
							tracked: false,
							pmBot: true,
							expectedBots: ["grok"],
						},
					);
				});
			},
		);
	});

	test("a settings save keeps a tracked project added after the draft loaded", async () => {
		const added = { tracker: "github" as const, repo: quiet };
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & {
					trackers: unknown;
					projects: unknown;
				};
				const {
					trackers: _trackers,
					projects: _projects,
					...baseline
				} = loaded;
				const other = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...baseline,
						tracked: [...baseline.tracked, added],
					}),
				});
				expect(other.status).toBe(200);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...baseline,
						pollIntervalSeconds: 60,
						tracked: baseline.tracked,
						baselineTracked: baseline.tracked,
					}),
				});
				expect(saved.status).toBe(200);
				const body = (await saved.json()) as Configuration;
				expect(body.pollIntervalSeconds).toBe(60);
				expect(body.tracked).toEqual([
					{ tracker: "github", repo: shown },
					added,
				]);
			},
		);
	});
});
