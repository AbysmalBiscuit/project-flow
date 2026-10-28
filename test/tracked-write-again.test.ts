import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { urlOf } from "./support/fetch.ts";
import { emptyProjectFields, unrecorded } from "./support/github.ts";
import { settledOverview } from "./support/reads.ts";

const board = {
	id: "PVT_local",
	number: 4,
	title: "Local board",
	closed: false,
	updatedAt: "2026-10-18T12:00:00.000Z",
	owner: { login: "lev" },
};

test("a later tracked-list write starts its own poll", async () => {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [],
			pollIntervalSeconds: 3600,
			tracked: [{ tracker: "github", owner: "lev", project: 4 }],
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let viewerPolls = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ViewerProjects")
		) {
			viewerPolls += 1;
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [board],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							organizations: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectItems")
		) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url === "https://api.github.com/graphql") {
			return (
				emptyProjectFields(input, init) ??
				new Response(
					JSON.stringify({ data: { node: { fields: { nodes: [{}] } } } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				)
			);
		}
		return unrecorded(input);
	};
	let base = "";
	let onListen: (line: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		onListen = (line: string) => {
			base = line;
			void (async () => {
				await Bun.sleep(50);
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as { tracked: unknown[] };
				const cleared = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...settings,
						tracked: [],
						baselineTracked: settings.tracked,
					}),
				});
				expect(cleared.status).toBe(200);
				const afterClear = viewerPolls;
				const restored = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...settings,
						tracked: [{ tracker: "github", owner: "lev", project: 4 }],
						baselineTracked: [],
					}),
				});
				expect(restored.status).toBe(200);
				expect(viewerPolls).toBeGreaterThan(afterClear);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as { projects: { name: string }[] };
				expect(overview.projects.map((project) => project.name)).toEqual([
					"Local board",
				]);
				resolve();
			})().catch((error: unknown) => {
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => onListen(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

test("a refresh during a tracked-list save joins that save's poll", async () => {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [],
			pollIntervalSeconds: 3600,
			tracked: [{ tracker: "github", owner: "lev", project: 4 }],
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let viewerPolls = 0;
	let releaseFresh: () => void = () => {};
	const freshHeld = new Promise<void>((resolve) => {
		releaseFresh = resolve;
	});
	let noteFreshStarted: () => void = () => {};
	const freshStarted = new Promise<void>((resolve) => {
		noteFreshStarted = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ViewerProjects")
		) {
			const index = viewerPolls;
			viewerPolls += 1;
			if (index > 0) {
				noteFreshStarted();
				await freshHeld;
			}
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [board],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
							organizations: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectItems")
		) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url === "https://api.github.com/graphql") {
			return (
				emptyProjectFields(input, init) ??
				new Response(
					JSON.stringify({ data: { node: { fields: { nodes: [{}] } } } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				)
			);
		}
		return unrecorded(input);
	};
	let base = "";
	let onListen: (line: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		onListen = (line: string) => {
			base = line;
			void (async () => {
				await settledOverview(base, async (url) => {
					const response = await fetch(new URL("/api/overview", url));
					return (await response.json()) as { polling?: true };
				});
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as { tracked: unknown[] };
				const before = viewerPolls;
				const write = fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...settings,
						tracked: [],
						baselineTracked: settings.tracked,
					}),
				});
				await freshStarted;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				// The refresh route queues its poll as a microtask before it answers.
				const during = viewerPolls;
				expect(during).toBe(before + 1);
				releaseFresh();
				const saved = await write;
				expect(saved.status).toBe(200);
				expect(viewerPolls).toBe(during);
				resolve();
			})().catch((error: unknown) => {
				releaseFresh();
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => onListen(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releaseFresh();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
