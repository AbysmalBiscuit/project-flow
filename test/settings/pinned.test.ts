import { describe, expect, test } from "bun:test";

import type { Configuration, ProjectPin } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import { settledOverview } from "../support/reads.ts";
import { quiet, savedRepo, shown, withApp } from "./_support.ts";

const tracked: ProjectPin[] = [
	{ tracker: "github", repo: shown },
	{ tracker: "github", repo: quiet },
	{ tracker: "github", repo: savedRepo },
];

async function save(base: string, next: Configuration): Promise<Response> {
	return fetch(new URL("/api/settings", base), {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(next),
	});
}

async function overviewNames(base: string): Promise<string[]> {
	const body = await settledOverview(
		base,
		async (url) =>
			(await (await fetch(new URL("/api/overview", url))).json()) as Overview,
	);
	return body.projects.map((project) => project.name);
}

describe("pinned projects", () => {
	test("a saved pin puts the project first for an ascending and a descending sort", async () => {
		await withApp(JSON.stringify({ tracked }), async (base) => {
			expect(await overviewNames(base)).toEqual([savedRepo, quiet, shown]);

			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const pinned = await save(base, {
				...current,
				pinnedProjects: [{ tracker: "github", repo: shown }],
			});
			expect(pinned.status).toBe(200);
			const written = (await pinned.json()) as Configuration;
			expect(written.pinnedProjects).toEqual([
				{ tracker: "github", repo: shown },
			]);
			expect(written.tracked).toEqual(tracked);
			expect(await overviewNames(base)).toEqual([shown, savedRepo, quiet]);

			const descending = await save(base, {
				...written,
				overview: { ...written.overview, direction: "desc" },
			});
			expect(descending.status).toBe(200);
			expect(await overviewNames(base)).toEqual([shown, quiet, savedRepo]);
		});
	});

	test("a legacy pinned list tracks the projects and pins none", async () => {
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: shown },
					{ tracker: "github", repo: quiet },
				],
			}),
			async (base) => {
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(settings.tracked).toEqual([
					{ tracker: "github", repo: shown },
					{ tracker: "github", repo: quiet },
				]);
				expect(settings.pinnedProjects).toEqual([]);
				expect(await overviewNames(base)).toEqual([quiet, shown]);
			},
		);
	});
});
