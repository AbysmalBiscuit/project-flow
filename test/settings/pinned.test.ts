import { describe, expect, test } from "bun:test";

import type { Configuration, ProjectPin } from "../../src/configuration.ts";
import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import { settledOverview } from "../support/reads.ts";
import { quiet, recorded, savedRepo, shown, withApp } from "./_support.ts";

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

	test("a pin-only save answers while a poll is held open and sends no tracker request", async () => {
		let releaseReads: () => void = () => {};
		const readsHeld = new Promise<void>((resolve) => {
			releaseReads = resolve;
		});
		let enteredHold: () => void = () => {};
		const holding = new Promise<void>((resolve) => {
			enteredHold = resolve;
		});
		let holdReads = false;
		const held =
			(requests: string[]): Fetch =>
			async (input, init) => {
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					holdReads &&
					urlOf(input) === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					enteredHold();
					await readsHeld;
				}
				return recorded(requests, input, init);
			};
		const pins: ProjectPin[] = [
			{ tracker: "github", repo: shown },
			{ tracker: "github", repo: quiet },
		];
		try {
			await withApp(
				JSON.stringify({ tracked: pins }),
				async (base, _path, requests) => {
					expect(await overviewNames(base)).toEqual([quiet, shown]);
					holdReads = true;
					const refreshing = fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					await holding;
					const current = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as Configuration;
					const sent = requests.length;
					const pinned = await save(base, {
						...current,
						pinnedProjects: [{ tracker: "github", repo: shown }],
					});
					expect(pinned.status).toBe(200);
					expect(requests.length).toBe(sent);
					const during = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as Overview;
					expect(during.projects.map((project) => project.name)).toEqual([
						shown,
						quiet,
					]);
					expect(requests.length).toBe(sent);
					holdReads = false;
					releaseReads();
					expect((await refreshing).status).toBe(204);

					const written = (await pinned.json()) as Configuration;
					const settled = requests.length;
					const polled = await save(base, {
						...written,
						pinnedProjects: [],
						pollIntervalSeconds: 120,
					});
					expect(polled.status).toBe(200);
					expect(requests.length).toBeGreaterThan(settled);
					expect(await overviewNames(base)).toEqual([quiet, shown]);
				},
				undefined,
				held,
			);
		} finally {
			releaseReads();
		}
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
