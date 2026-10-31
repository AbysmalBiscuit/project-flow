import { describe, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Configuration } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { settledOverview } from "../support/reads.ts";
import {
	checkoutFor,
	fetching,
	listedBackends,
	quiet,
	recorded,
	savedRepo,
	savedRoot,
	shown,
	withApp,
	withAppFile,
} from "./_support.ts";

describe("settings", () => {
	test("a settings change writes a valid configuration and untracks the project", async () => {
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(before.projects.map((project) => project.name).sort()).toEqual([
					shown,
				]);

				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pollIntervalSeconds).toBe(300);
				expect(current.needsYouLabels).toEqual([
					"needs-human",
					"needs-engineer",
				]);
				expect(current.notificationTriggers).toEqual({
					needsYou: true,
					comment: true,
					blockerCleared: true,
				});

				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						tracked: [{ tracker: "github", repo: quiet }],
						pollIntervalSeconds: 120,
						expectedBots: { [quiet]: ["grok"] },
						pmBot: { [quiet]: false },
						needsYouLabels: ["needs-human"],
						notificationTriggers: {
							needsYou: false,
							comment: true,
							blockerCleared: false,
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.tracked).toEqual([{ tracker: "github", repo: quiet }]);
				expect(written.pollIntervalSeconds).toBe(120);
				expect(written.expectedBots).toEqual({ [quiet]: ["grok"] });
				expect(written.pmBot).toEqual({ [quiet]: false });
				expect(written.needsYouLabels).toEqual(["needs-human"]);
				expect(written.notificationTriggers.needsYou).toBe(false);
				const reread = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(reread).toEqual(written);

				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const after = await settledOverview(base, async (url) => {
					return (await (
						await fetch(new URL("/api/overview", url))
					).json()) as Overview;
				});
				expect(after.projects.map((project) => project.name)).toEqual([quiet]);
				expect(
					requests.some((url) => url.includes(`/repos/${quiet}/issues?`)),
				).toBe(true);
				expect(
					requests.some((url) => url.includes(`/repos/${shown}/issues?`)),
				).toBe(true);
			},
		);
	});

	test("an invalid settings write names the field and leaves the file", async () => {
		await withApp(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
			async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ pollIntervalSeconds: 0, extra: true }),
				});
				expect(saved.status).toBe(400);
				const body = (await saved.json()) as { error: string };
				expect(body.error).toContain("pollIntervalSeconds");
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after).toEqual(before);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				expect(overview.projects.map((project) => project.name)).toContain(
					shown,
				);
			},
		);
	});

	test("repeated spaces and a blank number name the field and leave the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					tracked: [{ tracker: "github", repo: "  acme/spaced  " }],
				}),
			});
			expect(saved.status).toBe(400);
			const spaced = (await saved.json()) as { error: string };
			expect(spaced.error).toContain("tracked");
			const afterSpaces = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterSpaces).toEqual(before);
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					pollIntervalSeconds: Number("   "),
				}),
			});
			expect(blank.status).toBe(400);
			const named = (await blank.json()) as { error: string };
			expect(named.error).toContain("pollIntervalSeconds");
			const afterBlank = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterBlank).toEqual(before);
		});
	});

	test("a settings write during a refresh keeps the saved values", async () => {
		let releaseIssues: () => void = () => {};
		const issuesHeld = new Promise<void>((resolve) => {
			releaseIssues = resolve;
		});
		let enteredHold: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			enteredHold = resolve;
		});
		let holdIssues = false;
		const heldRequests: string[] = [];
		const held: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			if (
				holdIssues &&
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				enteredHold();
				await issuesHeld;
			}
			return recorded(heldRequests, input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: shown }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-settings-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					const ready = await fetch(new URL("/api/overview", base));
					expect(ready.status).toBe(200);
					holdIssues = true;
					const refreshing = fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					await holding;
					const current = await (
						await fetch(new URL("/api/settings", base))
					).json();
					const saving = fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...current,
							pollIntervalSeconds: 90,
						}),
					});
					holdIssues = false;
					await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
					releaseIssues();
					const saved = await saving;
					expect(saved.status).toBe(200);
					expect(await saved.json()).toMatchObject({
						pollIntervalSeconds: 90,
					});
					expect((await refreshing).status).toBe(204);
					const after = await (
						await fetch(new URL("/api/settings", base))
					).json();
					expect(after).toMatchObject({
						pollIntervalSeconds: 90,
					});
					expect(
						heldRequests.some((url) => url.includes(`/repos/${shown}/issues?`)),
					).toBe(true);
				})().then(resolve, reject);
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
					fetch: held,
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
			releaseIssues();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a saved checkout root lists only the checkout that root returns", async () => {
		const startupRoot = "/var/tmp/project-flow-startup-root";
		await withApp(
			JSON.stringify({ checkoutRoots: [startupRoot] }),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration & { projects: { key: string }[] };
				expect(current.projects.map((project) => project.key)).not.toContain(
					savedRepo,
				);
				expect(current.checkoutRoots).toEqual([startupRoot]);
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						checkoutRoots: [savedRoot],
					}),
				});
				expect(saved.status).toBe(200);
				const put = (await saved.json()) as Configuration & {
					projects: { key: string }[];
				};
				expect(put.checkoutRoots).toEqual([savedRoot]);
				expect(put.projects.map((project) => project.key)).toContain(savedRepo);
				const reread = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(reread.checkoutRoots).toEqual([savedRoot]);
			},
			async (roots) =>
				roots.includes(savedRoot) ? [checkoutFor(savedRoot)] : [],
		);
	});

	test("an unknown bot names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					expectedBots: { "acme/shown": ["not-a-bot"] },
				}),
			});
			expect(saved.status).toBe(400);
			const named = (await saved.json()) as { error: string };
			expect(named.error).toContain("expectedBots");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("a symlinked 0600 config stays a symlink and its target keeps mode 0600", async () => {
		const dir = await mkdtemp(join(tmpdir(), "project-flow-settings-link-"));
		const target = join(dir, "target.json");
		const link = join(dir, "config.json");
		await writeFile(
			target,
			JSON.stringify({
				tracked: [{ tracker: "github", repo: shown }],
				checkoutRoots: [],
			}),
		);
		await chmod(target, 0o600);
		await symlink(target, link);
		const root = await mkdtemp(join(tmpdir(), "project-flow-settings-"));
		const requests: string[] = [];
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				(async () => {
					const current = await (
						await fetch(new URL("/api/settings", base))
					).json();
					const saved = await fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...current,
							pollIntervalSeconds: 120,
						}),
					});
					expect(saved.status).toBe(200);
					const linkStat = await lstat(link);
					expect(linkStat.isSymbolicLink()).toBe(true);
					const targetStat = await lstat(target);
					expect(targetStat.isSymbolicLink()).toBe(false);
					expect(targetStat.mode & 0o777).toBe(0o600);
					const written = (await saved.json()) as Configuration;
					expect(written.pollIntervalSeconds).toBe(120);
					const reread = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(reread.pollIntervalSeconds).toBe(120);
					expect(
						requests.some((url) => url.includes(`/repos/${shown}/issues?`)),
					).toBe(true);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", link, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
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
			await rm(dir, { recursive: true, force: true });
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank PM Bot line and a bare name leave the saved flags", async () => {
		const linear = "linear-project";
		const savedFlags = { [linear]: true, [quiet]: false };
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", repo: shown },
				],
				pmBot: savedFlags,
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pmBot).toEqual(savedFlags);

				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						pmBot: `${linear} true\n\n${quiet}`,
					}),
				});
				expect(rejected.status).toBe(400);
				const body = (await rejected.json()) as { error: string };
				expect(body.error).toContain("pmBot");

				const written = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(written.pmBot).toEqual(savedFlags);
			},
		);
	});

	test("an unchanged menu keeps an explicit PM Bot false", async () => {
		const linear = "linear-project";
		const savedFlags = { [linear]: true, [quiet]: false };
		await withApp(
			JSON.stringify({
				tracked: [
					{ tracker: "linear", project: linear },
					{ tracker: "github", repo: shown },
				],
				pmBot: savedFlags,
			}),
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(current.pmBot).toEqual(savedFlags);

				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(current),
				});
				expect(saved.status).toBe(200);
				const body = (await saved.json()) as Configuration;
				expect(body.pmBot).toEqual(savedFlags);

				const written = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(written.pmBot).toEqual(savedFlags);
			},
		);
	});

	test("each settings section saves and survives a restart", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base, configPath) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration & {
				trackers: unknown;
				forges: unknown;
				switches: unknown;
			};
			const { trackers, forges, switches } = before;
			expect({ trackers, forges, switches }).toEqual(listedBackends("present"));
			expect(JSON.stringify(before)).not.toContain("recorded-token");
			expect(JSON.stringify(before)).not.toContain("recorded-linear-key");

			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					tracked: [{ tracker: "github", repo: shown }],
					pollIntervalSeconds: 60,
					projectViews: {
						"*": {
							openView: "graph",
							graphDirection: "top-to-bottom",
							shownLanes: ["In progress", "Done"],
							maxAgeDays: { Done: 7 },
							needsYouOnly: true,
							blockedOnly: false,
							assignees: [],
							search: "",
						},
					},
					laneMappings: {
						"acme/4": { awaitingMerge: "Approved" },
					},
					autoMerge: { "acme/shown": "ask" },
					needsYouLabels: ["needs-human"],
					viewerLogins: ["AbysmalBiscuit"],
					notificationTriggers: {
						needsYou: false,
						comment: true,
						blockerCleared: false,
					},
				}),
			});
			expect(saved.status).toBe(200);
			const body = (await saved.json()) as Configuration;
			expect(body.tracked).toEqual([{ tracker: "github", repo: shown }]);
			expect(body.pollIntervalSeconds).toBe(60);
			expect(body.projectViews["*"]?.openView).toBe("graph");
			expect(body.projectViews["*"]?.graphDirection).toBe("top-to-bottom");
			expect(body.projectViews["*"]?.shownLanes).toEqual([
				"In progress",
				"Done",
			]);
			expect(body.projectViews["*"]?.maxAgeDays).toEqual({ Done: 7 });
			expect(body.projectViews["*"]?.needsYouOnly).toBe(true);
			expect(body.laneMappings["acme/4"]).toEqual({
				awaitingMerge: "Approved",
			});
			expect(body.autoMerge).toEqual({ "acme/shown": "ask" });
			expect(body.needsYouLabels).toEqual(["needs-human"]);
			expect(body.viewerLogins).toEqual(["AbysmalBiscuit"]);
			expect(body.notificationTriggers).toEqual({
				needsYou: false,
				comment: true,
				blockerCleared: false,
			});
			expect(JSON.stringify(body)).not.toContain("recorded-token");

			await withAppFile(configPath, async (restarted) => {
				const again = (await (
					await fetch(new URL("/api/settings", restarted))
				).json()) as Configuration & {
					trackers: unknown;
					forges: unknown;
					switches: unknown;
				};
				expect(again.tracked).toEqual([{ tracker: "github", repo: shown }]);
				expect(again.pollIntervalSeconds).toBe(60);
				expect(again.projectViews["*"]?.openView).toBe("graph");
				expect(again.projectViews["*"]?.needsYouOnly).toBe(true);
				expect(again.laneMappings["acme/4"]?.awaitingMerge).toBe("Approved");
				expect(again.autoMerge["acme/shown"]).toBe("ask");
				expect(again.needsYouLabels).toEqual(["needs-human"]);
				expect(again.viewerLogins).toEqual(["AbysmalBiscuit"]);
				expect(again.notificationTriggers.blockerCleared).toBe(false);
				expect({
					trackers: again.trackers,
					forges: again.forges,
					switches: again.switches,
				}).toEqual(listedBackends("present"));
				expect(JSON.stringify(again)).not.toContain("recorded-linear-key");
			});
		});
	});
});
