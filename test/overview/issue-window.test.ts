import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	githubSince,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import { githubIssueNode, repoReadFromHandler } from "../support/repo-read.ts";
import { githubTicket, readServedOverview } from "./_support.ts";

describe("GET /api/overview", () => {
	test("a later issue window sends its own ETag, not the full read's", async () => {
		const repoName = "acme/since-window";
		const fullEtag = '"recorded-full-issues"';
		const windowEtag = '"recorded-window-issues"';
		const sent: { url: string; headers: Headers; body: string }[] = [];
		const reads = new Map<string, number>();
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({
				url,
				headers: new Headers(init?.headers),
				body: typeof init?.body === "string" ? init.body : "",
			});
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repoName,
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page([githubTicket(4, "open", null)], null, { etag: fullEtag });
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return url.includes("/check-runs")
					? Response.json({ check_runs: [] })
					: url.includes("/commits/")
						? Response.json({ commit: { committer: { date: null } } })
						: page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					readOf(body);
					const listed = await repoReadFromHandler(input, init, recorded);
					if (listed?.ok) {
						const payload = (await listed.json()) as {
							data: {
								repository: Record<string, unknown>;
								editedIssues?: unknown;
							};
						};
						if (body.includes("editedQuery")) {
							payload.data.editedIssues = {
								nodes: [githubIssueNode(githubTicket(8, "open", null))],
								pageInfo: { hasNextPage: false, endCursor: null },
							};
						}
						return Response.json(payload, {
							headers: { etag: windowEtag },
						});
					}
					return listed ?? unrecorded(input);
				}
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
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-since-"));
		const clock = { polls: 0, frozen: false };
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets.map((item) => item.key)).toEqual([
						`${repoName}#4`,
					]);
					clock.frozen = true;
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readServedOverview);
					expect(after.projects[0]?.tickets.map((item) => item.key)).toEqual([
						`${repoName}#4`,
						`${repoName}#8`,
					]);
					const again = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(again.status).toBe(204);
					const kept = await settledOverview(base, readServedOverview);
					expect(kept.projects[0]?.tickets).toEqual(after.projects[0]?.tickets);
					expect(kept.error).toBeNull();
					const repoReads = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					const full = repoReads.filter(
						(item) => !item.body.includes("editedQuery"),
					);
					const windows = repoReads.filter((item) =>
						item.body.includes("editedQuery"),
					);
					expect(full.length).toBeGreaterThan(0);
					expect(windows.length).toBeGreaterThan(0);
					expect(windows[0]?.body).toContain(`repo:${repoName}`);
					expect(windows[0]?.body).not.toContain(fullEtag);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => {
						if (!clock.frozen) {
							clock.polls += 1;
						}
						return new Date(
							Date.parse("2026-10-18T12:00:00.000Z") + clock.polls,
						);
					},
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

	test("a later issue window does not send a superseded window's ETag", async () => {
		const repoName = "acme/window-evict";
		const otherRepo = "acme/other-window";
		const stableEtag = '"recorded-stable-pulls"';
		const sent: { url: string; headers: Headers; body: string }[] = [];
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			sent.push({ url, headers: new Headers(init?.headers), body });
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return new Response(
					JSON.stringify([
						{
							full_name: repoName,
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
						{
							full_name: otherRepo,
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url.includes(`/repos/${repoName}/issues?`) ||
				url.includes(`/repos/${otherRepo}/issues?`)
			) {
				const number = url.includes(repoName) ? 4 : 1;
				return page([githubTicket(number, "open", null)], null);
			}
			if (url.includes("/pulls?")) {
				if (url.includes("state=closed")) {
					return page([], null);
				}
				return page([], null, { etag: stableEtag });
			}
			if (url.includes("/labels?")) {
				return page([], null);
			}
			if (url.includes("/branches?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				if (body.includes("query RepoRead")) {
					const listed = await repoReadFromHandler(input, init, recorded);
					if (listed?.ok) {
						const payload = (await listed.json()) as {
							data: { editedIssues?: unknown };
						};
						if (body.includes("editedQuery")) {
							const editedRepo = body.includes(otherRepo)
								? otherRepo
								: repoName;
							payload.data.editedIssues = {
								nodes: [
									githubIssueNode(
										githubTicket(
											editedRepo === otherRepo ? 2 : 8,
											"open",
											null,
										),
									),
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							};
						}
						return Response.json(payload);
					}
					return listed ?? unrecorded(input);
				}
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
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: repoName },
					{ tracker: "github", repo: otherRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-evict-"));
		const clockPath = join(root, "clock");
		await writeFile(clockPath, "2026-10-18T12:00:00.000Z");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(
						before.projects
							.find((project) => project.name === repoName)
							?.tickets.map((item) => item.key),
					).toEqual([`${repoName}#4`]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					await settledOverview(base, readServedOverview);
					await writeFile(clockPath, "2026-10-18T12:01:00.000Z");
					const sameWindow = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(sameWindow.status).toBe(204);
					await settledOverview(base, readServedOverview);
					const moved = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(moved.status).toBe(204);
					await settledOverview(base, readServedOverview);
					const windows = sent.filter(
						(item) =>
							item.body.includes("query RepoRead") &&
							item.body.includes(repoName) &&
							item.body.includes("editedQuery"),
					);
					expect(windows.length).toBeGreaterThan(1);
					expect(windows[0]?.body).toContain(
						githubSince("2026-10-18T12:00:00.000Z"),
					);
					expect(windows.at(-1)?.body).toContain(
						githubSince("2026-10-18T12:01:00.000Z"),
					);
					expect(windows[0]?.body).not.toBe(windows.at(-1)?.body);
					const otherWindows = sent.filter(
						(item) =>
							item.body.includes("query RepoRead") &&
							item.body.includes(otherRepo) &&
							item.body.includes("editedQuery"),
					);
					expect(otherWindows.length).toBeGreaterThan(1);
					expect(otherWindows[0]?.body).toContain(
						githubSince("2026-10-18T12:00:00.000Z"),
					);
					expect(otherWindows.at(-1)?.body).toContain(
						githubSince("2026-10-18T12:01:00.000Z"),
					);
					const pullReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/pulls?state=open`),
					);
					expect(pullReads.length).toBeGreaterThan(1);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date(readFileSync(clockPath, "utf8")),
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

	test("a failed poll still sends the current issue window's ETag", async () => {
		const repoName = "acme/window-retry";
		const sent: {
			url: string;
			headers: Headers;
			status: number;
			body: string;
		}[] = [];
		let failWindow = false;
		let repoReads = 0;
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const note = (status: number, response: Response): Response => {
				sent.push({
					url,
					headers: new Headers(init?.headers),
					status,
					body,
				});
				return response;
			};
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return note(
					200,
					new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
				);
			}
			if (url.startsWith("https://api.github.com/user/repos")) {
				return note(
					200,
					new Response(
						JSON.stringify([
							{
								full_name: repoName,
								pushed_at: "2026-10-18T12:00:00.000Z",
							},
						]),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
				);
			}
			if (
				url.includes(`/repos/${repoName}/issues?`) &&
				url.includes("page=1")
			) {
				return note(200, page([githubTicket(4, "open", null)], null));
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions") ||
				url.includes("/check-runs") ||
				url.includes("/commits/")
			) {
				return note(
					200,
					url.includes("/check-runs")
						? Response.json({ check_runs: [] })
						: url.includes("/commits/")
							? Response.json({ commit: { committer: { date: null } } })
							: page([], null),
				);
			}
			if (url === "https://api.github.com/graphql") {
				if (body.includes("query RepoRead")) {
					repoReads += 1;
					if (failWindow) {
						failWindow = false;
						return note(503, new Response("unavailable", { status: 503 }));
					}
					const listed = await repoReadFromHandler(input, init, recorded);
					return note(listed?.status ?? 500, listed ?? unrecorded(input));
				}
				return note(
					200,
					new Response(
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
					),
				);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-retry-"));
		const clockPath = join(root, "clock");
		await writeFile(clockPath, "2026-10-18T12:00:00.000Z");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await settledOverview(base, readServedOverview);
					expect(first.projects.length).toBeGreaterThan(0);
					const seen = repoReads;
					failWindow = true;
					const failed = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(failed.status).toBe(204);
					const failedBody = await settledOverview(base, readServedOverview);
					expect(repoReads).toBeGreaterThan(seen);
					expect(
						`${failedBody.error ?? ""} ${failedBody.projects[0]?.error ?? ""} ${sent.map((item) => item.status).join(",")}`,
					).toContain("503");
					const retry = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(retry.status).toBe(204);
					const recovered = await settledOverview(base, readServedOverview);
					expect(recovered.projects[0]?.error).toBeNull();
					const windows = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					expect(windows.length).toBeGreaterThan(1);
					expect(windows.some((item) => item.status === 503)).toBe(true);
					expect(
						windows.filter((item) => item.status === 200).length,
					).toBeGreaterThan(0);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date(readFileSync(clockPath, "utf8")),
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
});
