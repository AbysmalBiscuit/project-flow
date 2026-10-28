import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { githubSince } from "../support/github.ts";
import { readOverview, settledOverview } from "../support/reads.ts";
import {
	emptyPage,
	type GraphqlRequest,
	membership,
	operationName,
	renamed,
} from "./_support.ts";

describe("batched GitHub reads", () => {
	test("a refresh after a failed poll reads GitHub again and a later refresh reads the new title", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let reads = 0;
		let failNext = false;
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (operationName(request.query) !== "RepoRead") {
							return renamed(owner, name);
						}
						queries.push(request);
						reads += 1;
						if (failNext) {
							failNext = false;
							return null;
						}
						const body = renamed(owner, name);
						const issue = body.data.repository.issues.nodes[0];
						if (issue !== undefined && reads > 2) {
							issue.title = "Recovered ticket";
						}
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						const wait = async () => {
							while (true) {
								const response = await fetch(
									new URL("/api/overview", line),
								).catch(() => null);
								if (response?.ok === true) {
									releaseReady();
									return;
								}
								await Bun.sleep(20);
							}
						};
						void wait();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const first = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(first.error).toBeNull();
			failNext = true;
			const failedRefresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(failedRefresh.status).toBe(204);
			const failed = await settledOverview(base, readOverview<Overview>);
			expect(failed.projects[0]?.error).toContain("GitHub read repo failed");
			expect(failed.projects[0]?.tickets).toHaveLength(2);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const recovered = await settledOverview(base, readOverview<Overview>);
			expect(recovered.error).toBeNull();
			expect(recovered.projects[0]?.tickets).toHaveLength(2);
			const again = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(again.status).toBe(204);
			const updated = await settledOverview(base, readOverview<Overview>);
			expect(updated.projects[0]?.tickets[0]?.title).toBe("Recovered ticket");
			expect(queries.length).toBeGreaterThanOrEqual(3);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an edited comment on an unchanged issue reaches the next incremental poll", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		const progress = "**Workcell progress**\n- stage 2: implementing";
		try {
			let base = "";
			let ticks = 0;
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						const body = renamed(owner, name);
						if (operationName(request.query) !== "RepoRead") {
							return body;
						}
						queries.push(request);
						const since = request.variables.since;
						const issue = body.data.repository.issues.nodes[0];
						if (issue === undefined) {
							return body;
						}
						issue.updatedAt = "2026-04-01T08:00:00.000Z";
						issue.comments = {
							nodes:
								since === null
									? [
											{
												databaseId: 1,
												body: progress,
												createdAt: "2026-04-01T10:04:00.000Z",
												updatedAt: "2026-04-01T10:04:00.000Z",
												author: { login: "ada" },
												reactions: { totalCount: 0 },
											},
										]
									: [],
							pageInfo: emptyPage.pageInfo,
						};
						if (since !== null) {
							body.data.repository.issues.nodes = [];
							body.data.editedIssues = {
								nodes: [
									{
										...issue,
										comments: {
											nodes: [
												{
													databaseId: 1,
													body: `${progress}\n- stage 4: implementing`,
													createdAt: "2026-04-01T10:04:00.000Z",
													updatedAt: "2026-04-01T12:05:10.000Z",
													author: { login: "ada" },
													reactions: { totalCount: 0 },
												},
											],
											pageInfo: emptyPage.pageInfo,
										},
									},
								],
								pageInfo: emptyPage.pageInfo,
							};
						}
						body.data.repository.openPullRequests.nodes = [];
						body.data.repository.mergedPullRequests.nodes = [];
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const first = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { tickets: { run?: { stage?: string } }[] };
			expect(first.tickets[0]?.run?.stage).toBe("stage 2");
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview<Overview>);
			const second = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { tickets: { run?: { stage?: string } }[] };
			expect(second.tickets[0]?.run?.stage).toBe("stage 4");
			expect(
				queries.some((request) => request.query.includes("editedIssues")),
			).toBe(true);
			expect(
				queries.filter((request) => request.variables.since !== null).length,
			).toBeGreaterThan(0);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an incremental refresh shares one repository snapshot", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (operationName(request.query) !== "RepoRead") {
							return renamed(owner, name);
						}
						queries.push(request);
						const body = renamed(owner, name);
						const issues = body.data.repository.issues;
						if (request.variables.since != null) {
							const issue = issues.nodes[0];
							issues.nodes = issue === undefined ? [] : [issue];
							issues.pageInfo = { hasNextPage: false, endCursor: null };
							return body;
						}
						if (request.variables.afterIssues != null) {
							const issue = structuredClone(issues.nodes[0] ?? {});
							issue.number = 200;
							issue.updatedAt = "2026-01-01T00:00:00.000Z";
							issues.nodes = [issue];
							issues.pageInfo = { hasNextPage: false, endCursor: null };
							return body;
						}
						issues.pageInfo = { hasNextPage: true, endCursor: "issue-2" };
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const before = queries.length;
			expect(
				queries
					.slice(0, before)
					.some((request) => request.variables.afterIssues != null),
			).toBe(true);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview<Overview>);
			const incremental = queries.slice(before);
			expect(incremental.map((request) => request.variables.since)).toEqual([
				githubSince("2026-08-18T12:00:00.000Z"),
			]);
			expect(
				incremental.map((request) => request.variables.afterIssues),
			).toEqual([null]);
			expect(
				incremental.every((request) => request.query.includes("issues(")),
			).toBe(true);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(
				overview.projects
					.find((item) => item.name === "acme/widget")
					?.tickets.map((ticket) => ticket.key)
					.sort(),
			).toEqual(["acme/widget#101", "acme/widget#102", "acme/widget#200"]);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
