import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Configuration } from "../../src/configuration.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recorded, shown, withApp, withAppFile } from "./_support.ts";

describe("settings", () => {
	test("a saved dark theme survives a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.theme).toBe("light");
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, theme: "dark" }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			});
		} finally {
			await cleanup();
		}
	}, 30_000);

	test("a settings save keeps a theme written after the menu loaded", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const loaded = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(loaded.theme).toBe("light");
			const theme = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...loaded, theme: "dark" }),
			});
			expect(theme.status).toBe(200);
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...loaded,
					pollIntervalSeconds: 90,
					theme: (
						(await (
							await fetch(new URL("/api/settings", base))
						).json()) as Configuration
					).theme,
				}),
			});
			expect(saved.status).toBe(200);
			const written = (await saved.json()) as Configuration;
			expect(written.theme).toBe("dark");
			expect(written.pollIntervalSeconds).toBe(90);
			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(current.theme).toBe("dark");
			expect(current.pollIntervalSeconds).toBe(90);
		});
	});

	test("a settings save keeps a theme edit made in the loaded menu", async () => {
		await withApp(
			JSON.stringify({ pinned: [], theme: "dark" }),
			async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...loaded, theme: "light" }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("light");
			},
		);
	});

	test("a view-only settings write answers while a poll is held open and sends no tracker request", async () => {
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
					const beforeRefresh = heldRequests.length;
					holdIssues = true;
					const refreshing = fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					await holding;
					const current = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(current.theme).toBe("light");
					const sent = heldRequests.length;
					const saving = fetch(new URL("/api/settings", base), {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ...current, theme: "dark" }),
					});
					const saved = await saving;
					expect(saved.status).toBe(200);
					expect(heldRequests.length).toBe(sent);
					const written = (await saved.json()) as Configuration;
					expect(written.theme).toBe("dark");
					expect(written.tracked).toEqual(current.tracked);
					expect(written.pollIntervalSeconds).toBe(current.pollIntervalSeconds);
					const page = await fetch(new URL("/", base));
					expect(page.status).toBe(200);
					expect(await page.text()).toContain('data-theme="dark"');
					holdIssues = false;
					releaseIssues();
					expect((await refreshing).status).toBe(204);
					expect(heldRequests.length).toBeGreaterThan(beforeRefresh);
					const after = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					expect(after.theme).toBe("dark");
					expect(after.pollIntervalSeconds).toBe(current.pollIntervalSeconds);
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

	test("a theme save writes the current settings shape and sends no tracker request", async () => {
		await withApp(
			JSON.stringify({ pinned: [] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.theme).toBe("light");
				const sent = requests.length;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, theme: "dark" }),
				});
				expect(saved.status).toBe(200);
				expect(requests.length).toBe(sent);
				const written = (await saved.json()) as Configuration;
				expect(written.theme).toBe("dark");
				expect(written.tracked).toEqual(before.tracked);
				expect(written.pollIntervalSeconds).toBe(before.pollIntervalSeconds);
				expect(written.overview).toEqual(before.overview);
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(again.theme).toBe("dark");
				const page = await fetch(new URL("/", base));
				expect(page.status).toBe(200);
				expect(await page.text()).toContain('data-theme="dark"');
			},
		);
	});

	test("a blank theme and an unknown theme name the field and leave the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, theme: "   " }),
			});
			expect(blank.status).toBe(400);
			const blankBody = (await blank.json()) as { error: string };
			expect(blankBody.error).toContain("theme");
			const afterBlank = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterBlank).toEqual(before);
			const unknown = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...before, theme: "sepia" }),
			});
			expect(unknown.status).toBe(400);
			const unknownBody = (await unknown.json()) as { error: string };
			expect(unknownBody.error).toContain("theme");
			const afterUnknown = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(afterUnknown).toEqual(before);
		});
	});

	test("a project graph direction and layout survive a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						projectViews: {
							"acme/widget": {
								graphDirection: "top-to-bottom",
								graphLayout: "force",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.projectViews["acme/widget"]).toMatchObject({
					graphDirection: "top-to-bottom",
					graphLayout: "force",
				});
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.projectViews["acme/widget"]).toMatchObject({
					graphDirection: "top-to-bottom",
					graphLayout: "force",
				});
			});
		} finally {
			await cleanup();
		}
	});

	test("an unknown project graph direction names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const rejected = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					projectViews: {
						"acme/widget": { graphDirection: "sideways" },
					},
				}),
			});
			expect(rejected.status).toBe(400);
			const body = (await rejected.json()) as { error: string };
			expect(body.error).toContain("projectViews");
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("overview filter, sort and view mode survive a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const overview = {
			filter: "needs-you",
			sort: "blockedBy",
			direction: "desc",
			view: "table",
			showNeedsYou: true,
		} as const;
		try {
			await withAppFile(path, async (base) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(before.overview).toEqual({
					filter: "all",
					sort: "project",
					direction: "asc",
					view: "cards",
					showNeedsYou: true,
				});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...before, overview }),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as Configuration;
				expect(written.overview).toEqual(overview);
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.overview).toEqual(overview);
			});
		} finally {
			await cleanup();
		}
	});

	test("a saved table column and direction survive a restart", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [],
				overview: { filter: "all", sort: "name", view: "cards" },
			}),
		);
		const overview = {
			filter: "all",
			sort: "needsYou",
			direction: "desc",
			view: "table",
			showNeedsYou: true,
		} as const;
		try {
			await withAppFile(path, async (base) => {
				const loaded = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(loaded.overview).toEqual({
					filter: "all",
					sort: "project",
					direction: "asc",
					view: "cards",
					showNeedsYou: true,
				});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...loaded, overview }),
				});
				expect(saved.status).toBe(200);
				expect(((await saved.json()) as Configuration).overview).toEqual(
					overview,
				);
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...loaded,
						overview: { ...overview, direction: "   " },
					}),
				});
				expect(blank.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(kept.overview).toEqual(overview);
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.overview).toEqual(overview);
			});
		} finally {
			await cleanup();
		}
	});

	test("a blank overview filter names the field and leaves the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const blank = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					overview: { filter: "   " as const, sort: "name", view: "cards" },
				}),
			});
			expect(blank.status).toBe(400);
			const body = (await blank.json()) as { error: string };
			expect(body.error).toContain("overview.filter");
			const repeated = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					overview: { filter: "sepia" as const, sort: "name", view: "cards" },
				}),
			});
			expect(repeated.status).toBe(400);
			const after = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(after).toEqual(before);
		});
	});

	test("an overview view save skips the tracker poll and any other save polls", async () => {
		await withApp(
			JSON.stringify({ pinned: [] }),
			async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const seen = requests.length;
				const viewOnly = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						overview: {
							filter: "needs-you",
							sort: "progress",
							direction: "asc",
							view: "table",
						},
					}),
				});
				expect(viewOnly.status).toBe(200);
				const saved = (await viewOnly.json()) as Configuration;
				expect(saved.overview).toEqual({
					filter: "needs-you",
					sort: "progress",
					direction: "asc",
					view: "table",
					showNeedsYou: true,
				});
				expect(requests.length).toBe(seen);

				const other = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...saved,
						pollIntervalSeconds: 120,
					}),
				});
				expect(other.status).toBe(200);
				expect(requests.length).toBeGreaterThan(seen);
				const after = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(after.pollIntervalSeconds).toBe(120);
				expect(after.overview.view).toBe("table");
			},
		);
	});

	test("the board open view round-trips", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;

			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...before,
					projectViews: {
						"*": {
							openView: "board",
							graphDirection: "left-to-right",
							shownLanes: ["In progress"],
							maxAgeDays: {},
							needsYouOnly: false,
							blockedOnly: false,
							assignees: [],
							search: "",
						},
					},
				}),
			});
			expect(saved.status).toBe(200);
			const body = (await saved.json()) as Configuration;
			expect(body.projectViews["*"]?.openView).toBe("board");

			const again = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(again.projectViews["*"]?.openView).toBe("board");
		});
	});
});
