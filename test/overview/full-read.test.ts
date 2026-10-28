import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview, ProjectReport } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	githubSince,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";
import { emptyList, readServedOverview } from "./_support.ts";

describe("GET /api/overview", () => {
	test("a restart with a good-poll time and an empty snapshot reads the issue list without since", async () => {
		const repoName = "acme/empty-poll";
		const issueUpdatedAt = "2026-09-01T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		let issuePhase: "empty" | "recovered" = "empty";
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				if (issuePhase === "empty") {
					return page([], null);
				}
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-empty-poll-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stopFill: () => void = () => {};
		const fillStopped = new Promise<void>((resolve) => {
			stopFill = resolve;
		});
		let filled: (base: string) => void = () => {};
		const fill = new Promise<string>((resolve) => {
			filled = resolve;
		});
		const fillRun = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				stdout: filled,
				waitForStop: fillStopped,
			}),
		);
		let stopRestart: () => void = () => {};
		const restartStopped = new Promise<void>((resolve) => {
			stopRestart = resolve;
		});
		let restartRun: Promise<unknown> = Promise.resolve();
		try {
			const base = await fill;
			const emptyOverview = await fetch(new URL("/api/overview", base));
			expect(emptyOverview.status).toBe(200);
			const emptyBody = (await emptyOverview.json()) as Overview;
			expect(emptyBody.projects[0]?.tickets).toEqual([]);
			expect(emptyBody.error).toBeNull();
			expect(repoReads).toEqual([{ since: null }]);
			stopFill();
			await fillRun;
			repoReads.length = 0;
			issuePhase = "recovered";
			const recovered = new Promise<void>((resolve, reject) => {
				restartRun = run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo(
						{
							env: { GITHUB_TOKEN: "recorded-token" },
							fetch: recordedFetch,
							readGhToken: async () => null,
							databasePath,
							stdout: (line) => {
								void (async () => {
									// Count the reads before the overview read, so a poll that
									// starts during that read cannot pass for a settled one.
									let readsBefore = repoReads.length;
									let overviewBody = await readServedOverview(line);
									while (overviewBody.polling === true || readsBefore === 0) {
										await Bun.sleep(20);
										readsBefore = repoReads.length;
										overviewBody = await readServedOverview(line);
									}
									expect(repoReads).toEqual([{ since: null }]);
									expect(overviewBody.error).toBeNull();
									expect(overviewBody.projects[0]?.tickets).toEqual([
										{
											key: `${repoName}#9`,
											title: "Ticket 9",
											state: "backlog",
											blockers: [],
											lane: "Backlog",
											statusType: "backlog",
											enteredStateAt: issueUpdatedAt,
											updatedAt: issueUpdatedAt,
										},
									]);
									const project = await fetch(
										new URL(
											`/api/projects/${encodeURIComponent(repoName)}`,
											line,
										),
									);
									expect(project.status).toBe(200);
									const report = (await project.json()) as ProjectReport;
									expect(report.tickets.map((ticket) => ticket.key)).toEqual([
										`${repoName}#9`,
									]);
									expect(report.total).toBe(1);
									resolve();
								})().catch(reject);
							},
							waitForStop: restartStopped,
						},
						{ first: true },
					),
				).then((result) => {
					reject(
						new Error(
							`app exited ${result.exitCode} before the recovered overview: ${result.stderr}`,
						),
					);
					return result;
				}, reject);
			});
			await recovered;
			stopRestart();
			const result = await restartRun;
			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
		} finally {
			stopFill();
			stopRestart();
			await fillRun;
			await restartRun;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a start with a good-poll time and no snapshot reads the issue list without since", async () => {
		const repoName = "acme/missing-row";
		const issueUpdatedAt = "2026-09-01T12:00:00.000Z";
		const goodPollAt = "2026-10-18T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-missing-row-"));
		const databasePath = join(root, "project-flow.sqlite");
		const seeded = new Database(databasePath);
		seeded.run(`
			create table project_polls (
				project text primary key,
				fetched_at text not null
			)
		`);
		seeded
			.query("insert into project_polls (project, fetched_at) values (?, ?)")
			.run(repoName, goodPollAt);
		seeded.close();
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					let overviewBody = await readServedOverview(base);
					while (overviewBody.polling === true || repoReads.length === 0) {
						await Bun.sleep(20);
						overviewBody = await readServedOverview(base);
					}
					expect(repoReads).toEqual([{ since: null }]);
					expect(overviewBody.error).toBeNull();
					expect(overviewBody.projects[0]?.tickets).toEqual([
						{
							key: `${repoName}#9`,
							title: "Ticket 9",
							state: "backlog",
							blockers: [],
							lane: "Backlog",
							statusType: "backlog",
							enteredStateAt: issueUpdatedAt,
							updatedAt: issueUpdatedAt,
						},
					]);
					const project = await fetch(
						new URL(`/api/projects/${encodeURIComponent(repoName)}`, base),
					);
					expect(project.status).toBe(200);
					const report = (await project.json()) as ProjectReport;
					expect(report.tickets.map((ticket) => ticket.key)).toEqual([
						`${repoName}#9`,
					]);
					expect(report.total).toBe(1);
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
						fetch: recordedFetch,
						readGhToken: async () => null,
						databasePath,
						stdout: (line) => startChecks(line),
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

	test("a tracked repo whose issues a tracked board claims keeps incremental reads", async () => {
		const projectId = "PVT_claimed_repo";
		const repoName = "acme/claimed-repo";
		const issueUpdatedAt = "2026-10-18T12:00:00.000Z";
		const repoReads: { since: string | null }[] = [];
		const claimed: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, claimed);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page(
					[
						{
							number: 9,
							title: "Ticket 9",
							state: "open",
							state_reason: null,
							html_url: `https://github.com/${repoName}/issues/9`,
							updated_at: issueUpdatedAt,
						},
					],
					null,
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectByNumber")
			) {
				return new Response(
					JSON.stringify({
						data: {
							repositoryOwner: {
								projectV2: {
									id: projectId,
									number: 4,
									title: "Claimed board",
									closed: false,
									updatedAt: "2026-08-18T12:00:00Z",
								},
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("node(id:")
			) {
				return new Response(
					JSON.stringify({
						data: {
							node: {
								items: {
									nodes: [
										{
											content: {
												__typename: "Issue",
												number: 9,
												title: "Ticket 9",
												state: "OPEN",
												stateReason: null,
												updatedAt: issueUpdatedAt,
												repository: { nameWithOwner: repoName },
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
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", owner: "acme", project: 4 },
					{ tracker: "github", repo: repoName },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-claimed-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let ready: (base: string) => void = () => {};
		const opened = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const started = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: claimed,
				readGhToken: async () => null,
				databasePath,
				stdout: ready,
				waitForStop: stopped,
			}),
		);
		try {
			const base = await opened;
			const first = await settledOverview(base, readServedOverview);
			expect(first.error).toBeNull();
			expect(
				first.projects.find((project) => project.name === repoName)?.tickets,
			).toEqual([]);
			expect(
				first.projects.find((project) => project.name === "Claimed board")
					?.tickets,
			).toEqual([
				{
					key: `${repoName}#9`,
					title: "Ticket 9",
					state: "backlog",
					blockers: [],
					lane: "Backlog",
					statusType: "backlog",
					enteredStateAt: issueUpdatedAt,
					updatedAt: issueUpdatedAt,
				},
			]);
			expect(repoReads).toEqual([{ since: null }]);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			while (repoReads.length < 2) {
				await Bun.sleep(20);
			}
			const second = await settledOverview(base, readServedOverview);
			expect(second.error).toBeNull();
			const fetchedAt = first.projects.find(
				(project) => project.name === repoName,
			)?.fetchedAt;
			if (fetchedAt == null) {
				throw new Error("missing fetchedAt");
			}
			expect(repoReads[1]).toEqual({ since: githubSince(fetchedAt) });
			expect(repoReads[1]?.since).not.toBeNull();
		} finally {
			stop();
			await started;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a genuinely empty tracked project full-reads again on the next poll", async () => {
		const repoName = "acme/genuinely-empty";
		const repoReads: { since: string | null }[] = [];
		const recordedFetch: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body = typeof init?.body === "string" ? init.body : "";
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (
				url === "https://api.github.com/graphql" &&
				body.includes("query RepoRead")
			) {
				const parsed = JSON.parse(body) as {
					variables?: { since?: string | null };
				};
				const since = parsed.variables?.since;
				repoReads.push({
					since: since === undefined || since === null ? null : String(since),
				});
				const listed = await repoReadFromHandler(input, init, recordedFetch);
				return listed ?? unrecorded(input);
			}
			if (url.includes(`/repos/${repoName}/issues?`)) {
				return page([], null);
			}
			return emptyList(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: repoName }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-empty-again-"));
		const databasePath = join(root, "project-flow.sqlite");
		let stop: () => void = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		let ready: (base: string) => void = () => {};
		const opened = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const started = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch,
				readGhToken: async () => null,
				databasePath,
				stdout: ready,
				waitForStop: stopped,
			}),
		);
		try {
			const base = await opened;
			const first = await settledOverview(base, readServedOverview);
			expect(first.error).toBeNull();
			expect(first.projects[0]?.tickets).toEqual([]);
			expect(repoReads).toEqual([{ since: null }]);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			while (repoReads.length < 2) {
				await Bun.sleep(20);
			}
			const second = await settledOverview(base, readServedOverview);
			expect(second.error).toBeNull();
			expect(second.projects[0]?.tickets).toEqual([]);
			expect(repoReads[1]).toEqual({ since: null });
		} finally {
			stop();
			await started;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
