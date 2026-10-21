import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const board = {
	id: "PVT_local",
	number: 4,
	title: "Local board",
	closed: false,
	updatedAt: "2026-10-18T12:00:00.000Z",
	owner: { login: "lev" },
};

test("a tracked-list write waits for a poll that started after the write", async () => {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [],
			pollIntervalSeconds: 3600,
			tracked: [{ tracker: "github", owner: "lev", project: 4 }],
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let releasePoll: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	let projectReads = 0;
	let viewerPolls = 0;
	let releaseFirst: () => void = () => {};
	const firstEntered = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

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
			projectReads += 1;
			if (projectReads === 1) {
				releaseFirst();
				await held;
			}
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
				await firstEntered;
				expect(projectReads).toBe(1);
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					tracked: unknown[];
					projects: { name: string; ref: unknown }[];
				};
				expect(settings.projects.map((project) => project.name)).toEqual([
					"Local board",
				]);
				const write = fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...settings,
						tracked: [],
						baselineTracked: settings.tracked,
					}),
				});
				let settled = false;
				void write.then(() => {
					settled = true;
				});
				await Bun.sleep(30);
				expect(settled).toBe(false);
				releasePoll();
				const saved = await write;
				expect(saved.status).toBe(200);
				expect(viewerPolls).toBeGreaterThan(1);
				const body = (await saved.json()) as { tracked: unknown[] };
				expect(body.tracked).toEqual([]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as { projects: { name: string }[]; fetchedAt: string | null };
				expect(overview.projects).toEqual([]);
				expect(overview.fetchedAt).toBe("2026-10-18T12:00:00.000Z");
				resolve();
			})().catch((error: unknown) => {
				releasePoll();
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
		releasePoll();
		releaseFirst();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
