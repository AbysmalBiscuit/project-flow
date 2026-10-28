import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import { repoReadFromHandler, repoReadResponse } from "../support/repo-read.ts";
import { emptyList, githubTicket, readServedOverview } from "./_support.ts";

describe("GET /api/overview", () => {
	test("a second poll of an unchanged repo sends the first ETag and a 304 keeps the overview", async () => {
		const repoName = "acme/unchanged";
		const etag = '"recorded-issues-etag"';
		const pullEtag = '"recorded-pulls-etag"';
		const closedEtag = '"recorded-closed-pulls-etag"';
		const sent: { url: string; headers: Headers; body: string }[] = [];
		const reads = new Map<string, number>();
		const openPull = {
			number: 9,
			title: "Ship the widget",
			state: "open",
			draft: true,
			html_url: `https://github.com/${repoName}/pull/9`,
			body: "",
			head: { ref: "ship-widget", sha: "" },
		};
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			const headers = new Headers(init?.headers);
			sent.push({
				url,
				headers,
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
							owner: { login: "lev" },
							permissions: { push: true },
							pushed_at: "2026-10-18T12:00:00.000Z",
						},
					]),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				readOf(url);
				return page([githubTicket(4, "open", null)], null, { etag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=open`)) {
				readOf(url);
				return page([openPull], null, { etag: pullEtag });
			}
			if (url.includes(`/repos/${repoName}/pulls?state=closed`)) {
				readOf(url);
				return page([], null, { etag: closedEtag });
			}
			if (url.includes("/branches?") || url.includes("/labels?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
				}
				const read = repoReadResponse(input, init);
				if (read !== null) {
					return read;
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
							repository: {
								pullRequest: { closingIssuesReferences: { nodes: [] } },
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
		const root = await mkdtemp(join(tmpdir(), "project-flow-etag-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects.map((project) => project.name)).toEqual([
						repoName,
					]);
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					expect(before.projects[0]?.unlinkedPrs).toEqual([
						{
							number: 9,
							title: "Ship the widget",
							url: `https://github.com/${repoName}/pull/9`,
							repo: repoName,
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readServedOverview);
					expect(after.projects).toEqual(before.projects);
					const repoReads = sent.filter((item) =>
						item.body.includes("query RepoRead"),
					);
					// One poll shares one repository snapshot, so a start plus a
					// refresh is two reads.
					expect(repoReads).toHaveLength(2);
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
					now: () => new Date("2026-10-18T12:00:00.000Z"),
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

	test("a 304 with no stored ETag keeps the prior overview", async () => {
		const repoName = "acme/blank-interval";
		const sent: { url: string; headers: Headers }[] = [];
		const reads = new Map<string, number>();
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({ url, headers: new Headers(init?.headers) });
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
				readOf(url);
				return page([githubTicket(4, "open", null)], null);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
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
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-blank-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readServedOverview);
					expect(after.projects).toEqual(before.projects);
					expect(after.error).toBeNull();
					const issueReads = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/issues?`),
					);
					expect(issueReads[1]?.headers.get("if-none-match")).toBeNull();
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
					now: () => new Date("2026-10-18T12:00:00.000Z"),
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

	test("a 304 on a later page keeps that page's branches on the overview", async () => {
		const repoName = "acme/paged-branches";
		const pageEtag = '"recorded-branches-page-1"';
		const laterEtag = '"recorded-branches-page-2"';
		const issueEtag = '"recorded-paged-issues"';
		const later = `https://api.github.com/repos/${repoName}/branches?per_page=100&page=2`;
		const sent: { url: string; headers: Headers }[] = [];
		const reads = new Map<string, number>();
		const readOf = (url: string): number => {
			const count = (reads.get(url) ?? 0) + 1;
			reads.set(url, count);
			return count;
		};
		const recorded: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({ url, headers: new Headers(init?.headers) });
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
				readOf(url);
				return page([githubTicket(21, "open", null)], null, {
					etag: issueEtag,
				});
			}
			if (
				url.includes(`/repos/${repoName}/branches?`) &&
				!url.includes("page=2")
			) {
				readOf(url);
				return page([{ name: "main" }], later, { etag: pageEtag });
			}
			if (url === later) {
				readOf(url);
				return page([{ name: "21-feat-ship-the-widget" }], null, {
					etag: laterEtag,
				});
			}
			if (url.includes("/pulls?") || url.includes("/labels?")) {
				return page([], null);
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recorded);
				if (listed !== null) {
					return listed;
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
		const root = await mkdtemp(join(tmpdir(), "project-flow-pages-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const first = await fetch(new URL("/api/overview", base));
					expect(first.status).toBe(200);
					const before = (await first.json()) as Overview;
					expect(before.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#21`,
							title: "Ticket 21",
							state: "inProgress",
							blockers: [],
							lane: "In progress",
							statusType: "inProgress",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const after = await settledOverview(base, readServedOverview);
					expect(after.projects).toEqual(before.projects);
					expect(after.error).toBeNull();
					expect(
						sent.filter((item) => item.url === later).length,
					).toBeGreaterThan(0);
					expect(
						sent.filter((item) => item.url === "https://api.github.com/graphql")
							.length,
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
					now: () => new Date("2026-10-18T12:00:00.000Z"),
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

	test("a repeated GitHub REST read sends If-None-Match and a 304 keeps the stored data", async () => {
		const repoName = "acme/validator";
		const labelsEtag = '"recorded-labels-etag"';
		const factoryLabels = [
			{ name: "ready", color: "0e8a16" },
			{ name: "factory: running", color: "1d76db" },
			{ name: "factory: in-review", color: "fbca04" },
		];
		const sent: { url: string; headers: Headers }[] = [];
		let labelReads = 0;
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			sent.push({ url, headers: new Headers(init?.headers) });
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 4,
							title: "Ticket 4",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/4`,
							updated_at: "2026-10-18T12:00:00.000Z",
							labels: [{ name: "factory: running", color: "1d76db" }],
						},
					],
					null,
				);
			}
			if (url.includes(`/repos/${repoName}/issues/events?`)) {
				return page([], null);
			}
			if (url.includes(`/repos/${repoName}/labels?`)) {
				labelReads += 1;
				if (labelReads > 1) {
					return new Response(null, {
						status: 304,
						headers: { etag: labelsEtag },
					});
				}
				return page(factoryLabels, null, {
					etag: labelsEtag,
				});
			}
			if (url === "https://api.github.com/graphql") {
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				if (listed?.ok) {
					const payload = (await listed.json()) as {
						data: { repository: { labels: { nodes: unknown[] } } };
					};
					payload.data.repository.labels.nodes = factoryLabels;
					return Response.json(payload);
				}
				if (listed !== null) {
					return listed;
				}
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-validator-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFirst: () => void = () => {};
		const firstStopped = new Promise<void>((resolve) => {
			stopFirst = resolve;
		});
		let firstReady: () => void = () => {};
		const firstListening = new Promise<void>((resolve) => {
			firstReady = resolve;
		});
		const firstRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: firstReady,
				waitForStop: firstStopped,
			}),
		);
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const opened = await fetch(new URL("/api/overview", base));
					expect(opened.status).toBe(200);
					while (labelReads < 2) {
						await Bun.sleep(20);
					}
					const after = (await opened.json()) as Overview;
					expect(after.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#4`,
							title: "Ticket 4",
							state: "inProgress",
							blockers: [],
							lane: "In progress",
							status: "factory: running",
							statusType: "inProgress",
							enteredStateAt: "2026-10-18T12:00:00.000Z",
							updatedAt: "2026-10-18T12:00:00.000Z",
						},
					]);
					const labelReadsSent = sent.filter((item) =>
						item.url.includes(`/repos/${repoName}/labels?`),
					);
					expect(labelReadsSent.length).toBeGreaterThan(1);
					expect(labelReadsSent[1]?.url).toBe(labelReadsSent[0]?.url);
					expect(labelReadsSent[0]?.headers.get("if-none-match")).toBeNull();
					expect(after.projects[0]?.error).toBeNull();
					const again = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(again.status).toBe(204);
					const kept = await fetch(new URL("/api/overview", base));
					const keptBody = (await kept.json()) as Overview;
					expect(keptBody.projects[0]?.tickets).toEqual(
						after.projects[0]?.tickets,
					);
					const failed = await fetch(new URL("/api/projects/%20", base));
					expect(failed.status).toBe(404);
					resolve();
				})().catch(reject);
			};
		});
		try {
			await firstListening;
			stopFirst();
			const first = await firstRun;
			expect(first.exitCode).toBe(0);
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recordedFetch,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			stopFirst();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
