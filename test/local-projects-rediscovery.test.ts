import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { urlOf } from "./support/fetch.ts";
import { emptyProjectFields, unrecorded } from "./support/github.ts";
import { readWhere, settledOverview, trackFound } from "./support/reads.ts";

const localBoard = {
	name: "Local board",
	tracker: "github",
	ref: { tracker: "github", owner: "lev", project: 4 },
	done: 0,
	dropped: 0,
	blocked: 0,
	backlog: 1,
	inProgress: 0,
	inReview: 0,
	awaitingMerge: 0,
	tags: [],
	unlinkedPrs: [],
	tickets: [
		{
			key: "lev/local-board#3",
			title: "Ship the board",
			state: "backlog",
			blockers: [],
			lane: "Backlog",
			statusType: "backlog",
			enteredStateAt: "2026-10-18T12:00:00.000Z",
			updatedAt: "2026-10-18T12:00:00.000Z",
		},
	],
	crossProjectBlockers: [],
	needsYou: 0,
	progress: 0,
	fetchedAt: "2026-10-18T12:00:00.000Z",
	error: null,
	statusTypes: {
		backlog: 1,
		inProgress: 0,
		inReview: 0,
		awaitingMerge: 0,
		done: 0,
		dropped: 0,
	},
};

function rediscoveryFetch(
	requests: string[],
	firstAnswer: Promise<void>,
): Fetch {
	let polls = 0;
	return async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ViewerProjects")
		) {
			polls += 1;
			requests.push(body);
			if (polls === 1) {
				await firstAnswer;
			}
			const nodes =
				polls === 1
					? []
					: [
							{
								id: "PVT_local",
								number: 4,
								title: "Local board",
								closed: false,
								updatedAt: "2026-10-18T12:00:00.000Z",
								owner: { login: "lev" },
							},
						];
			return new Response(
				JSON.stringify({
					data: {
						viewer: {
							login: "lev",
							projectsV2: {
								nodes,
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
}

describe("local projects", () => {
	test("a later poll rediscovers a GitHub project the first poll missed", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const requests: string[] = [];
		const fetchImpl = rediscoveryFetch(requests, Promise.resolve());
		let base = "";
		let onListen: (line: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			onListen = (line: string) => {
				base = line;
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					expect(await first.json()).toEqual({
						projects: [],
						fetchedAt: null,
						error: null,
						tracked: false,
					});
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					await trackFound(base);
					const second = await settledOverview(base, async (url) => {
						const response = await fetch(new URL("/api/overview", url));
						expect(response.status).toBe(200);
						return (await response.json()) as {
							projects: unknown[];
							fetchedAt: string | null;
							error: string | null;
							polling?: true;
						};
					});
					expect(second).toEqual({
						projects: [localBoard],
						fetchedAt: "2026-10-18T12:00:00.000Z",
						error: null,
					});
					expect(
						requests.filter((body) => body.includes("ViewerProjects")),
					).toHaveLength(3);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => onListen(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a settings read during a refresh answers at once, and a later read sees the refresh poll's catalogue", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [] }));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const requests: string[] = [];
		let answerFirst = () => {};
		const fetchImpl = rediscoveryFetch(
			requests,
			new Promise<void>((resolve) => {
				answerFirst = resolve;
			}),
		);
		let onListen: (line: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			onListen = (base: string) => {
				void (async () => {
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const early = (await (
						await fetch(new URL("/api/settings", base))
					).json()) as { projects: { ref: unknown }[] };
					expect(early.projects).toEqual([]);
					answerFirst();
					const settings = await readWhere<{ projects: { ref: unknown }[] }>(
						new URL("/api/settings", base),
						(body) => body.projects.length > 0,
					);
					expect(settings.projects.map((project) => project.ref)).toEqual([
						{ tracker: "github", owner: "lev", project: 4 },
					]);
					resolve();
				})().catch(reject);
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
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
