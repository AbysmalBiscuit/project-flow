import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import outsideRelations from "../fixtures/outside-relations.json";
import { tempConfig, testIo } from "../support/app.ts";
import {
	type TrackerRequest,
	trackerRequest,
	urlOf,
} from "../support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../support/github.ts";
import {
	blocked,
	blocker,
	blockerHeadline,
	gate,
	inboxOf,
	linearIssue,
	linearProject,
	notificationAfterRefresh,
	pinned,
	refresh,
	twoProjects,
	withInbox,
} from "./_support.ts";

describe("inbox", () => {
	test("closing the blocker ticket produces an event and an inbox entry", async () => {
		await withInbox(
			twoProjects,
			[blocked, blocker],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					blocked,
					{
						...blocker,
						state: { type: "completed" },
						updatedAt: "2026-08-18T15:00:00.000Z",
					},
				]);
				const event = await notificationAfterRefresh(base);
				expect(event).toMatchObject({
					trigger: "blockerCleared",
					project: "Project Flow",
					key: "GATE-9",
					text: blockerHeadline,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
			[linearProject, gate],
		);
	});

	test("closing an outside blocker raises Blocker cleared on the ticket it blocked", async () => {
		const recorded = outsideRelations.linearAut1040;
		const blockerRelation = recorded.inverseRelations.nodes.find(
			(relation) => relation.type === "blocks",
		);
		const blockerProject = blockerRelation?.issue.project;
		if (
			blockerRelation === undefined ||
			blockerProject === null ||
			blockerProject === undefined
		) {
			throw new Error("recorded AUT-1040 has no outside blocks relation");
		}
		const blockedTicket = {
			...linearIssue(
				recorded.identifier,
				recorded.title,
				recorded.description,
				[],
				{ state: recorded.state, inverseRelations: recorded.inverseRelations },
				recorded.updatedAt,
			),
			projectId: linearProject.id,
		};
		const closedOutside = {
			...blockedTicket,
			updatedAt: "2026-10-19T15:00:00.000Z",
			inverseRelations: {
				nodes: recorded.inverseRelations.nodes.map((relation) =>
					relation.type === "blocks"
						? {
								...relation,
								issue: {
									...relation.issue,
									state: { type: "completed" },
								},
							}
						: relation,
				),
			},
		};
		await withInbox(
			pinned,
			[blockedTicket],
			async (base, setIssues, _failComments, requests) => {
				expect(await inboxOf(base)).toEqual([]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as {
					projects: {
						name: string;
						tickets: { key: string; state: string }[];
						crossProjectBlockers: {
							project: string;
							tracker: string;
							key: string;
							title: string;
						}[];
					}[];
				};
				const project = overview.projects.find(
					(item) => item.name === "Project Flow",
				);
				expect(
					project?.tickets.find((item) => item.key === recorded.identifier)
						?.state,
				).toBe("backlog");
				expect(project?.crossProjectBlockers).toEqual([
					{
						project: blockerProject.name,
						tracker: "linear",
						key: blockerRelation.issue.identifier,
						title: blockerRelation.issue.title,
					},
				]);
				const issueReads = requests.filter((request) =>
					request.query.includes("ProjectIssues"),
				);
				expect(issueReads[0]?.query).toContain("inverseRelations");
				expect(issueReads[0]?.variables).toEqual(
					expect.objectContaining({
						filter: { project: { id: { eq: linearProject.id } } },
					}),
				);
				setIssues([closedOutside]);
				const event = await notificationAfterRefresh(base);
				expect(event).toMatchObject({
					trigger: "blockerCleared",
					project: "Project Flow",
					key: blockerRelation.issue.identifier,
					text: blockerRelation.issue.title,
				});
				expect(await inboxOf(base)).toEqual([event]);
				const cleared = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as {
					projects: { tickets: { key: string; state: string }[] }[];
				};
				expect(
					cleared.projects
						.flatMap((item) => item.tickets)
						.find((item) => item.key === recorded.identifier)?.state,
				).toBe("backlog");
			},
		);
	});

	test("a stale closed relation to a loaded open blocker raises no Blocker cleared", async () => {
		const alpha = {
			id: "project-alpha",
			name: "Alpha",
			slugId: "alpha",
		};
		const beta = {
			id: "project-beta",
			name: "Beta",
			slugId: "beta",
		};
		const recorded = outsideRelations.linearAut1040;
		const blockerRelation = recorded.inverseRelations.nodes.find(
			(relation) => relation.type === "blocks",
		);
		const blockerProject = blockerRelation?.issue.project;
		if (
			blockerRelation === undefined ||
			blockerProject === null ||
			blockerProject === undefined
		) {
			throw new Error("recorded AUT-1040 has no outside blocks relation");
		}
		const gate = {
			id: "project-gate-recorded",
			name: blockerProject.name,
			slugId: blockerProject.slugId,
		};
		const openBlocker = {
			...linearIssue(
				blockerRelation.issue.identifier,
				blockerRelation.issue.title,
				"",
				[],
				{ state: blockerRelation.issue.state },
				"2026-10-07T11:41:04.569Z",
			),
			projectId: gate.id,
		};
		const alphaTicket = {
			...linearIssue(
				recorded.identifier,
				recorded.title,
				recorded.description,
				[],
				{ state: recorded.state, inverseRelations: recorded.inverseRelations },
				recorded.updatedAt,
			),
			projectId: alpha.id,
		};
		const betaTicket = {
			...linearIssue(
				"BET-1",
				"Wait on the same gate",
				"",
				[],
				{
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									...blockerRelation.issue,
									state: { type: "completed" },
								},
							},
						],
					},
				},
				"2026-10-07T11:41:04.569Z",
			),
			projectId: beta.id,
		};
		const dropped = {
			...alphaTicket,
			updatedAt: "2026-10-19T15:00:00.000Z",
			inverseRelations: { nodes: [] },
		};
		await withInbox(
			{
				pinned: [
					{ tracker: "linear", project: alpha.slugId },
					{ tracker: "linear", project: beta.slugId },
					{ tracker: "linear", project: gate.slugId },
				],
				pollIntervalSeconds: 3600,
			},
			[alphaTicket, openBlocker, betaTicket],
			async (base, setIssues, _failComments, requests) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as {
					projects: {
						name: string;
						tickets: { key: string; state: string }[];
						crossProjectBlockers: {
							project: string;
							tracker: string;
							key: string;
							title: string;
						}[];
					}[];
				};
				const alphaView = overview.projects.find(
					(item) => item.name === alpha.name,
				);
				expect(alphaView?.crossProjectBlockers).toEqual([
					{
						project: gate.name,
						tracker: "linear",
						key: blockerRelation.issue.identifier,
						title: blockerRelation.issue.title,
					},
				]);
				expect(
					overview.projects.find((item) => item.name === beta.name)?.tickets[0]
						?.state,
				).toBe("backlog");
				setIssues([dropped, openBlocker, betaTicket]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				const after = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as typeof overview;
				expect(
					after.projects.find((item) => item.name === alpha.name)?.tickets[0]
						?.state,
				).not.toBe("blocked");
				expect(
					after.projects.find((item) => item.name === beta.name)?.tickets[0]
						?.state,
				).toBe("backlog");
				const issueReads = requests.filter((request) =>
					request.query.includes("ProjectIssues"),
				);
				expect(issueReads.length).toBeGreaterThan(0);
				expect(issueReads[0]?.query).toContain("inverseRelations");
				expect(issueReads[0]?.query).toContain("project { name slugId }");
			},
			[alpha, beta, gate],
		);
	});

	test("closing the last outside GitHub blocker raises Blocker cleared", async () => {
		const recorded = outsideRelations.githubFactory279;
		const dependency = outsideRelations.githubFactory279BlockedBy[0];
		if (recorded === undefined || dependency === undefined) {
			throw new Error("recorded factory issue 279 has no blocked_by response");
		}
		const repo = "AbysmalBiscuit/factory";
		const outsideRepo =
			dependency.repository_url.match(/\/repos\/([^/]+\/[^/]+)/)?.[1] ?? "";
		const outsideKey = `${outsideRepo}#${dependency.number}`;
		let closed = false;
		const requests: TrackerRequest[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const sent = trackerRequest(input, init);
			requests.push(sent);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url.startsWith(`https://api.github.com/repos/${repo}/issues?`) &&
				url.includes("state=all")
			) {
				return Response.json([
					{
						...recorded,
						updated_at: closed ? "2026-10-19T16:00:00Z" : recorded.updated_at,
						issue_dependencies_summary: closed
							? {
									...recorded.issue_dependencies_summary,
									blocked_by: 0,
								}
							: recorded.issue_dependencies_summary,
					},
				]);
			}
			if (url.includes(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				return Response.json([
					{
						...dependency,
						state: closed ? "closed" : dependency.state,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					const first = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as {
						projects: {
							name: string;
							crossProjectBlockers: {
								project: string;
								tracker: string;
								key: string;
								title: string;
							}[];
						}[];
					};
					expect(first.projects[0]?.crossProjectBlockers).toEqual([
						{
							project: outsideRepo,
							tracker: "github",
							key: outsideKey,
							title: dependency.title,
						},
					]);
					expect(
						requests.some((request) =>
							request.query.includes("query RepoRead"),
						),
					).toBe(true);
					const event = await notificationAfterRefresh(base, () => {
						closed = true;
					});
					expect(event).toMatchObject({
						trigger: "blockerCleared",
						project: repo,
						key: outsideKey,
						text: dependency.title,
					});
					expect(await inboxOf(base)).toEqual([event]);
					expect(
						requests.filter((request) =>
							request.url.includes(
								`/issues/${recorded.number}/dependencies/blocked_by`,
							),
						).length,
					).toBeGreaterThan(0);
					const dependencyReads = requests.filter((request) =>
						request.url.includes("/dependencies/blocked_by"),
					);
					expect(dependencyReads[0]?.url).toContain(
						`/repos/${repo}/issues/${recorded.number}/`,
					);
					expect(dependencyReads[0]?.query).toBe("");
					expect(dependencyReads[0]?.variables).toEqual({});
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: done,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank GitHub blocker title and a repeated space in the ticket title raise no Blocker cleared", async () => {
		const recorded = outsideRelations.githubFactory279;
		const dependency = outsideRelations.githubFactory279BlockedBy[0];
		if (recorded === undefined || dependency === undefined) {
			throw new Error("recorded factory issue 279 has no blocked_by response");
		}
		const repo = "AbysmalBiscuit/factory";
		const outsideRepo =
			dependency.repository_url.match(/\/repos\/([^/]+\/[^/]+)/)?.[1] ?? "";
		let phase: "open" | "blank" | "closed" = "open";
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url.startsWith(`https://api.github.com/repos/${repo}/issues?`) &&
				url.includes("state=all")
			) {
				return Response.json([
					{
						...recorded,
						title: phase === "blank" ? "   " : recorded.title,
						updated_at:
							phase === "open" ? recorded.updated_at : "2026-10-19T16:00:00Z",
						issue_dependencies_summary:
							phase === "closed"
								? { ...recorded.issue_dependencies_summary, blocked_by: 0 }
								: recorded.issue_dependencies_summary,
					},
				]);
			}
			if (url.includes(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				return Response.json([
					{
						...dependency,
						title: "   ",
						state: phase === "closed" ? "closed" : dependency.state,
					},
				]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					const outsideKey = `${outsideRepo}#${dependency.number}`;
					const first = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as {
						projects: {
							crossProjectBlockers: { key: string; title: string }[];
						}[];
					};
					expect(first.projects[0]?.crossProjectBlockers).toEqual([
						expect.objectContaining({
							key: outsideKey,
							title: outsideKey,
						}),
					]);
					phase = "blank";
					await refresh(base);
					expect(await inboxOf(base)).toEqual([]);
					const event = await notificationAfterRefresh(base, () => {
						phase = "closed";
					});
					expect(event).toMatchObject({
						trigger: "blockerCleared",
						project: repo,
						key: outsideKey,
						text: outsideKey,
					});
					expect(await inboxOf(base)).toEqual([event]);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: done,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed outside dependency read raises no Blocker cleared", async () => {
		const recorded = outsideRelations.githubFactory279;
		const dependency = outsideRelations.githubFactory279BlockedBy[0];
		if (recorded === undefined || dependency === undefined) {
			throw new Error("recorded factory issue 279 has no blocked_by response");
		}
		const repo = "AbysmalBiscuit/factory";
		let failed = false;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (
				url.startsWith(`https://api.github.com/repos/${repo}/issues?`) &&
				url.includes("state=all")
			) {
				return Response.json([recorded]);
			}
			if (url.includes(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				if (failed) {
					return unrecorded(input);
				}
				return Response.json([dependency]);
			}
			if (
				url.includes("/pulls?") ||
				url.includes("/branches?") ||
				url.includes("/labels?")
			) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					const first = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as {
						projects: { crossProjectBlockers: { key: string }[] }[];
					};
					expect(
						first.projects[0]?.crossProjectBlockers.length,
					).toBeGreaterThan(0);
					failed = true;
					await refresh(base);
					expect(await inboxOf(base)).toEqual([]);
				})().then(resolve, reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					stdout: (line) => startChecks(line),
					waitForStop: done,
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a blank outside title and a still-open outside relation raise no Blocker cleared", async () => {
		const recorded = outsideRelations.linearAut1040;
		const blockerRelation = recorded.inverseRelations.nodes.find(
			(relation) => relation.type === "blocks",
		);
		const blockerProject = blockerRelation?.issue.project;
		if (
			blockerRelation === undefined ||
			blockerProject === null ||
			blockerProject === undefined
		) {
			throw new Error("recorded AUT-1040 has no outside blocks relation");
		}
		const blockedTicket = {
			...linearIssue(
				recorded.identifier,
				recorded.title,
				recorded.description,
				[],
				{
					state: recorded.state,
					inverseRelations: {
						nodes: [
							{
								...blockerRelation,
								issue: { ...blockerRelation.issue, title: "   " },
							},
						],
					},
				},
				recorded.updatedAt,
			),
			projectId: linearProject.id,
		};
		const stillOpen = {
			...blockedTicket,
			updatedAt: "2026-10-19T15:00:00.000Z",
			description: "A note, with the same open blocker.",
		};
		await withInbox(pinned, [blockedTicket], async (base, setIssues) => {
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as {
				projects: {
					crossProjectBlockers: {
						project: string;
						tracker: string;
						key: string;
						title: string;
					}[];
				}[];
			};
			expect(
				overview.projects.flatMap((item) => item.crossProjectBlockers),
			).toEqual([
				{
					project: blockerProject.name,
					tracker: "linear",
					key: blockerRelation.issue.identifier,
					title: blockerRelation.issue.identifier,
				},
			]);
			setIssues([stillOpen]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("dropping the blocker line without closing the ticket adds no inbox entry", async () => {
		await withInbox(
			twoProjects,
			[blocked, blocker],
			async (base, setIssues) => {
				setIssues([
					{
						...blocked,
						description: "The gate is open.",
						updatedAt: "2026-08-18T15:00:00.000Z",
					},
					blocker,
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
			[linearProject, gate],
		);
	});
});
