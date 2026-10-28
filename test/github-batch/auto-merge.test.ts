import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import { readOverview, settledOverview } from "../support/reads.ts";
import {
	graphql,
	type GraphqlRequest,
	membership,
	operationName,
	renamed,
} from "./_support.ts";

describe("batched GitHub reads", () => {
	test("auto-merge metadata for an unreadable pull repo does not fail the Linear poll", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
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
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFake({
						issues: [
							{
								identifier: "WID-1",
								title: "Ship the list",
								description: "",
								updatedAt: "2026-08-18T12:00:00.000Z",
								state: {
									id: "st-done",
									name: "Done",
									type: "completed",
									color: "#4CB782",
								},
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/7",
											title: "fix: ship the list",
											sourceType: "github",
										},
									],
								},
							},
						],
						github: async (input, init) => {
							const request = graphql(input, init);
							if (operationName(request.query) === "RepoRead") {
								queries.push(request);
								if (!request.query.includes("issues(")) {
									return json({
										data: { repository: null },
										errors: [{ message: "recorded failure" }],
									});
								}
								return json(renamed("acme", "widget"));
							}
							const url = request.url;
							if (url === "https://api.github.com/user") {
								return json({ login: "lev" });
							}
							if (url === "https://api.github.com/repos/acme/widget/pulls/7") {
								return json({
									number: 7,
									title: "fix: ship the list",
									html_url: "https://github.com/acme/widget/pull/7",
									draft: false,
									body: "Closes WID-1",
									head: { ref: "7-feat", sha: "a".repeat(40) },
									state: "open",
									merged_at: null,
								});
							}
							if (
								url.includes("/pulls?") ||
								url.includes("/reviews") ||
								url.includes("/comments") ||
								url.includes("/reactions") ||
								url.includes("/check-runs") ||
								url.includes("/commits/")
							) {
								return json(
									url.includes("/check-runs") ? { check_runs: [] } : [],
								);
							}
							return membership([], () => null)(input, init);
						},
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
			const started = await Promise.race([
				ready.then(() => "ready" as const),
				running.then((finished) => finished),
			]);
			if (started !== "ready") {
				expect(started.stderr).toBe("");
				expect(started.exitCode).toBe(0);
			}
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			const project = overview.projects.find(
				(item) => item.name === "Widget launch",
			);
			expect(project?.error).toBeNull();
			expect(project?.tickets.map((ticket) => ticket.key)).toEqual(["WID-1"]);
			const metadata = queries.filter(
				(request) => !request.query.includes("issues("),
			);
			expect(metadata).toHaveLength(1);
			expect(metadata[0]?.query.includes("autoMergeAllowed")).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("auto-merge metadata for an unreadable repository does not fail the poll", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let failRead = false;
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
						if (failRead) {
							body.data.repository.autoMergeAllowed = null as never;
						}
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
			failRead = true;
			const before = queries.length;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const overview = await settledOverview(base, readOverview<Overview>);
			const project = overview.projects.find(
				(item) => item.name === "acme/widget",
			);
			expect(project?.error).toBeNull();
			expect(project?.tickets.map((ticket) => ticket.key).sort()).toEqual([
				"acme/widget#101",
				"acme/widget#102",
			]);
			const later = queries.slice(before);
			expect(later).toHaveLength(1);
			expect(later[0]?.query.includes("issues(")).toBe(true);
			expect(later[0]?.query.includes("autoMergeAllowed")).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
