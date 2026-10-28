import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import {
	type Connection,
	emptyPage,
	type GraphqlRequest,
	membership,
	operationName,
	renamed,
	type RepoBody,
	startCounted,
} from "./_support.ts";

describe("batched GitHub reads", () => {
	test("an unused label page still completes the factory lanes", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
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
						const body = renamed(owner, name);
						if (operationName(request.query) !== "RepoRead") {
							return body;
						}
						queries.push(request);
						body.data.repository.issues.nodes = [
							{
								...(body.data.repository.issues.nodes[0] ?? {}),
								number: 7,
								title: "Queue the job",
								labels: {
									nodes: [{ name: "ready", color: "0E8A16" }],
									pageInfo: emptyPage.pageInfo,
								},
							},
						];
						body.data.repository.openPullRequests.nodes = [];
						body.data.repository.mergedPullRequests.nodes = [];
						const labels = body.data.repository.labels;
						if (request.variables.afterLabels === null) {
							labels.nodes = [
								{ name: "ready", color: "0E8A16" },
								{ name: "unused", color: "FFFFFF" },
							];
							labels.pageInfo = { hasNextPage: true, endCursor: "label-2" };
							return body;
						}
						labels.nodes = [
							{ name: "factory: running", color: "1D76DB" },
							{ name: "factory: in-review", color: "FBCA04" },
						];
						labels.pageInfo = { hasNextPage: false, endCursor: null };
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
			const report = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { statuses: { name: string; colour: string }[] };
			expect(report.statuses.map((lane) => lane.name)).toContain("ready");
			expect(report.statuses.map((lane) => lane.name)).toContain(
				"factory: in-review",
			);
			expect(
				report.statuses.find((lane) => lane.name === "ready")?.colour,
			).toBe("#0E8A16");
			expect(queries.map((request) => request.variables.afterLabels)).toEqual([
				null,
				"label-2",
			]);
			expect(queries[1]?.query.includes("openPullRequests")).toBe(false);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a review on a later page reaches the overview", async () => {
		const { github, needsYou } = await startCounted(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			}),
			(owner, name, request) => {
				const body = renamed(owner, name);
				const pull = body.data.repository.openPullRequests.nodes[0];
				const reviews = pull?.reviews as
					Connection<Record<string, unknown>> | undefined;
				if (reviews === undefined) {
					return body;
				}
				if (operationName(request.query) === "NestedReview") {
					reviews.pageInfo = { hasNextPage: false, endCursor: null };
					return body;
				}
				reviews.pageInfo = { hasNextPage: true, endCursor: "review-2" };
				reviews.nodes = [];
				return body;
			},
		);
		expect(github.filter((url) => url.endsWith("/graphql")).length).toBe(5);
		expect(
			needsYou.find((item) => item.key === "acme/widget#101")?.pull?.review,
		).toBe("completed");
	});

	test("a later issue blocker, blocking link and label reach the overview", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
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
		const read = (
			owner: string,
			name: string,
			request: GraphqlRequest,
		): RepoBody | null => {
			const body = renamed(owner, name);
			const issue = body.data.repository.issues.nodes[0];
			if (issue === undefined) {
				return body;
			}
			issue.state = "OPEN";
			const connection = (
				nodes: Record<string, unknown>[],
				cursor: string | null,
			) => ({
				nodes,
				pageInfo: {
					hasNextPage: cursor !== null,
					endCursor: cursor,
				},
			});
			if (operationName(request.query) === "RepoRead") {
				const labels = body.data.repository.labels;
				if (request.variables.afterLabels == null) {
					labels.nodes = [];
					labels.pageInfo = { hasNextPage: true, endCursor: "label-2" };
				} else {
					labels.nodes = [
						{ name: "ready", color: "0E8A16" },
						{ name: "factory: running", color: "1D76DB" },
						{ name: "factory: in-review", color: "FBCA04" },
					];
					labels.pageInfo = { hasNextPage: false, endCursor: null };
				}
			}
			if (operationName(request.query) === "IssueRelations") {
				return {
					data: {
						repository: {
							nameWithOwner: `${owner}/${name}`,
							issue: {
								blockedBy: connection(
									[
										{
											number: 40,
											title: "Later blocker",
											state: "OPEN",
											repository: { nameWithOwner: `${owner}/${name}` },
										},
									],
									null,
								),
								blocking: connection(
									[
										{
											number: 41,
											title: "Later blocked",
											state: "OPEN",
											repository: { nameWithOwner: "acme/other" },
										},
									],
									null,
								),
								labels: connection(
									[{ name: "later-label", color: "ededed" }],
									null,
								),
							},
						},
					},
				} as unknown as RepoBody;
			}
			issue.blockedBy = connection([], "blocked-2");
			issue.blocking = connection([], "blocking-2");
			issue.labels = connection([], "labels-2");
			body.data.repository.issues.nodes = [issue];
			body.data.repository.openPullRequests.nodes = [];
			body.data.repository.mergedPullRequests.nodes = [];
			return body;
		};
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (request.query !== "") {
							queries.push(request);
						}
						return read(owner, name, request);
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
			const report = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as {
				statuses: { name: string }[];
				tickets: {
					key: string | null;
					blockers: string[];
					blocked?: boolean;
					lane?: string;
					status?: string;
				}[];
			};
			const ticket = report.tickets.find(
				(item) => item.key === "acme/widget#101",
			);
			expect(ticket?.blockers).toEqual(["acme/widget#40"]);
			expect(ticket?.blocked).toBe(true);
			expect(report.statuses.map((lane) => lane.name)).toContain(
				"factory: running",
			);
			expect(report.tickets[0]?.status).toBe("factory: running");
			expect(
				queries.some((request) => request.query.includes("IssueRelations")),
			).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
