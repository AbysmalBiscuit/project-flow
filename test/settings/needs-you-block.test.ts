import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { Configuration } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import { withApp } from "./_support.ts";

describe("the Needs you block setting", () => {
	test("a configuration file without the Needs you key shows the block", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base) => {
			const settings = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(settings.overview.showNeedsYou).toBe(true);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(overview.needsYouHidden).toBeUndefined();
		});
	});

	test("turning Needs you off hides the block and keeps the value in the file", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base, configPath) => {
			const loaded = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...loaded,
					overview: { ...loaded.overview, showNeedsYou: false },
					baselineShowNeedsYou: loaded.overview.showNeedsYou,
				}),
			});
			expect(saved.status).toBe(200);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(overview.needsYouHidden).toBe(true);
			const file = JSON.parse(await readFile(configPath, "utf8")) as {
				overview: { showNeedsYou: boolean };
			};
			expect(file.overview.showNeedsYou).toBe(false);
		});
	});

	test("an overview save from stale settings keeps Needs you off", async () => {
		await withApp(JSON.stringify({ pinned: [] }), async (base, configPath) => {
			const stale = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const hidden = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...stale,
					overview: { ...stale.overview, showNeedsYou: false },
					baselineShowNeedsYou: stale.overview.showNeedsYou,
				}),
			});
			expect(hidden.status).toBe(200);
			const sorted = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...stale,
					overview: { ...stale.overview, sort: "progress" },
					baselineShowNeedsYou: stale.overview.showNeedsYou,
				}),
			});
			expect(sorted.status).toBe(200);
			const written = (await sorted.json()) as Configuration;
			expect(written.overview).toEqual({
				...stale.overview,
				sort: "progress",
				showNeedsYou: false,
			});
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(overview.needsYouHidden).toBe(true);
			const file = JSON.parse(await readFile(configPath, "utf8")) as {
				overview: { showNeedsYou: boolean };
			};
			expect(file.overview.showNeedsYou).toBe(false);
		});
	});
});
