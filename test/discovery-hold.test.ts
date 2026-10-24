import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	settledOverview,
	tempConfig,
	testIo,
	trackFound,
	unrecorded,
	urlOf,
} from "./support.ts";

test("a settings read during discovery waits for the catalogue", async () => {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned: [], pollIntervalSeconds: 3600 }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let releaseDiscovery: () => void = () => {};
	const discoveryHeld = new Promise<void>((resolve) => {
		releaseDiscovery = resolve;
	});
	let polls = 0;
	let releaseFetch: () => void = () => {};
	const fetchHeld = new Promise<void>((resolve) => {
		releaseFetch = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ViewerProjects")
		) {
			polls += 1;
			if (polls === 1) {
				releaseFetch();
				await discoveryHeld;
				return new Response(
					JSON.stringify({
						data: {
							viewer: {
								login: "lev",
								projectsV2: {
									nodes: [],
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
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes: [
									{
										id: "PVT_local",
										number: 4,
										title: "Local board",
										closed: false,
										updatedAt: "2026-10-18T12:00:00.000Z",
										owner: { login: "lev" },
									},
								],
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
		if (url.startsWith("https://api.github.com/user/repos")) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectFields")
		) {
			return emptyProjectFields(input, init) ?? unrecorded(input);
		}
		if (url === "https://api.github.com/graphql" && body.includes("node(")) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											number: 3,
											title: "Ship the board",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-10-18T12:00:00.000Z",
											repository: { nameWithOwner: "lev/local-board" },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
	let base = "";
	let onListen: (line: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		onListen = (line: string) => {
			base = line;
			void (async () => {
				await fetchHeld;
				const pending = fetch(new URL("/api/settings", base));
				let settled = false;
				void pending.then(() => {
					settled = true;
				});
				await Bun.sleep(30);
				expect(settled).toBe(false);
				expect(polls).toBe(1);
				releaseDiscovery();
				const settings = (await (await pending).json()) as {
					projects: { name: string }[];
				};
				expect(settings.projects).toEqual([]);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await trackFound(base);
				const second = await settledOverview(base, async (url) => {
					const response = await fetch(new URL("/api/overview", url));
					expect(response.status).toBe(200);
					return (await response.json()) as {
						projects: { name: string }[];
						fetchedAt: string | null;
						error: string | null;
						polling?: true;
					};
				});
				expect(second.projects.map((project) => project.name)).toEqual([
					"Local board",
				]);
				expect(second.fetchedAt).toBe("2026-10-18T12:00:00.000Z");
				expect(polls).toBeGreaterThanOrEqual(2);
				resolve();
			})().catch((error: unknown) => {
				releaseDiscovery();
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
					waitForStop: checks.then(() => undefined),
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releaseDiscovery();
		releaseFetch();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
