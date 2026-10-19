import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import outsideRelations from "./fixtures/outside-relations.json";
import {
	linearFake,
	recordedDiscovery,
	type TrackerRequest,
	tempConfig,
	testIo,
	trackerRequest,
	urlOf,
} from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

const linearProject = {
	id: "project-flow",
	name: "Project Flow",
	slugId: "project-flow",
};

type InboxEntry = {
	id: string;
	trigger: "needsYou" | "comment" | "blockerCleared";
	project: string;
	key: string;
	text: string;
	at: string;
};

function linearIssue(
	identifier: string,
	title: string,
	description: string,
	comments: {
		body: string;
		createdAt?: string;
		user?: { name: string };
	}[] = [],
	fields: Record<string, unknown> = {},
	updatedAt = "2026-08-18T12:00:00.000Z",
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title,
		description,
		state: { type: "unstarted" },
		updatedAt,
		labels: { nodes: [] },
		comments: { nodes: comments },
		assignee: null,
		...fields,
	};
}

function recordedIssues(issues: Record<string, unknown>[]): Response {
	return Response.json({
		data: {
			issues: {
				nodes: issues,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

function bodyOf(init?: RequestInit): string {
	return typeof init?.body === "string" ? init.body : "";
}

function isPinQuery(
	input: string | URL | Request,
	init?: RequestInit,
): boolean {
	return (
		urlOf(input) === "https://api.linear.app/graphql" &&
		bodyOf(init).includes("ProjectByPin")
	);
}

function isIssueQuery(
	input: string | URL | Request,
	init?: RequestInit,
): boolean {
	return (
		urlOf(input) === "https://api.linear.app/graphql" &&
		bodyOf(init).includes("ProjectIssues")
	);
}

function notificationEvent(
	base: string,
	timeoutMs = 3_000,
): Promise<InboxEntry> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		let settled = false;
		const finish = (error?: Error, entry?: InboxEntry) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			void socket.then((open) => open.end());
			if (error !== undefined) {
				reject(error);
				return;
			}
			if (entry !== undefined) {
				resolve(entry);
			}
		};
		const socket = Bun.connect({
			hostname: "127.0.0.1",
			port: Number(new URL(base).port),
			socket: {
				data(_socket, data) {
					buffer += data.toString();
					const blocks = buffer.split("\n\n");
					buffer = blocks.pop() ?? "";
					for (const text of blocks) {
						const event = text
							.split("\n")
							.find((line) => line.startsWith("event:"))
							?.slice("event:".length)
							.trim();
						const payload = text
							.split("\n")
							.filter((line) => line.startsWith("data:"))
							.map((line) => line.slice("data:".length).trim())
							.join("\n");
						if (event === "notification" && payload !== "") {
							finish(undefined, JSON.parse(payload) as InboxEntry);
						}
					}
				},
				error(_socket, error) {
					finish(error);
				},
				open(openSocket) {
					openSocket.write(
						"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
					);
				},
			},
		});
		const timer = setTimeout(() => {
			finish(new Error("no notification event within 3000ms"));
		}, timeoutMs);
	});
}

async function withInbox(
	config: unknown,
	issues: Record<string, unknown>[],
	checks: (
		base: string,
		setIssues: (next: Record<string, unknown>[]) => void,
		failComments: (failed: boolean) => void,
		requests: TrackerRequest[],
	) => Promise<void>,
	projects: { id: string; name: string; slugId: string }[] = [linearProject],
): Promise<void> {
	let current = issues;
	let commentsFail = false;
	const requests: TrackerRequest[] = [];
	const recorded = linearFake({
		project: projects[0] ?? linearProject,
	});
	const fetchImpl: Fetch = async (input, init) => {
		requests.push(trackerRequest(input, init));
		if (
			commentsFail &&
			urlOf(input) === "https://api.linear.app/graphql" &&
			bodyOf(init).includes("IssueComments")
		) {
			return new Response("recorded failure", { status: 500 });
		}
		if (isIssueQuery(input, init)) {
			const body = bodyOf(init);
			const projectId = body.match(/"project":\{"id":\{"eq":"([^"]+)"/)?.[1];
			const project = projects.find((item) => item.id === projectId);
			const nodes = current.filter(
				(issue) =>
					issue.projectId === undefined || issue.projectId === projectId,
			);
			return recordedIssues(
				project === undefined
					? nodes
					: nodes.map((issue) => ({ ...issue, projectId: undefined })),
			);
		}
		if (isPinQuery(input, init)) {
			const slug = bodyOf(init).match(/"pin":"([^"]+)"/)?.[1];
			const project = projects.find((item) => item.slugId === slug) ?? null;
			return Response.json({
				data: { projects: { nodes: project === null ? [] : [project] } },
			});
		}
		return recorded(input, init);
	};
	const { path, cleanup } = await tempConfig(JSON.stringify(config));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			checks(
				base,
				(next) => {
					current = next;
				},
				(failed) => {
					commentsFail = failed;
				},
				requests,
			).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { LINEAR_API_KEY: "recorded-linear-key" },
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
}

const pinned = {
	pinned: [{ tracker: "linear", project: "project-flow" }],
	pollIntervalSeconds: 3600,
};

const gate = {
	id: "project-gate",
	name: "Gate",
	slugId: "gate",
};

const blockerHeadline = "Open the gate";

const blocked = {
	...linearIssue(
		"PF-2",
		"Hold the launch",
		"Blocked by: GATE-9",
		[],
		{},
		"2026-08-18T12:00:00.000Z",
	),
	projectId: linearProject.id,
};

const blocker = {
	...linearIssue(
		"GATE-9",
		blockerHeadline,
		"",
		[],
		{ state: { type: "started" } },
		"2026-08-18T12:00:00.000Z",
	),
	projectId: gate.id,
};

const twoProjects = {
	pinned: [
		{ tracker: "linear", project: "project-flow" },
		{ tracker: "linear", project: "gate" },
	],
	pollIntervalSeconds: 3600,
};

async function refresh(base: string): Promise<void> {
	const response = await fetch(new URL("/api/refresh", base), {
		method: "POST",
	});
	expect(response.status).toBe(204);
}

async function inboxOf(base: string): Promise<InboxEntry[]> {
	const response = await fetch(new URL("/api/inbox", base));
	expect(response.status).toBe(200);
	return (await response.json()) as InboxEntry[];
}

describe("inbox", () => {
	test("a new needs-you item produces an event and an inbox entry", async () => {
		const headline = "Which bot should review this?";
		await withInbox(pinned, [], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[{ body: `${headline}\n\n${ask("pf-1")}` }],
					{},
					"2026-08-18T13:00:00.000Z",
				),
			]);
			const events = notificationEvent(base);
			await Bun.sleep(50);
			await refresh(base);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a new comment on a needs-you ticket produces an event and an inbox entry", async () => {
		const headline = "Which bot should review this?";
		const first = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [first], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "A later note on the same ask.",
							createdAt: "2026-08-18T14:00:00.000Z",
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			const events = notificationEvent(base);
			await Bun.sleep(50);
			await refresh(base);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

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
				const events = notificationEvent(base);
				await Bun.sleep(50);
				await refresh(base);
				const event = await events;
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
				).toBe("blocked");
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
				const events = notificationEvent(base);
				await Bun.sleep(50);
				await refresh(base);
				const event = await events;
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
				).toBe("blocked");
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
				).toBe("blocked");
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
			if (url.endsWith(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				return Response.json([
					{
						...dependency,
						state: closed ? "closed" : dependency.state,
					},
				]);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return new Response("not recorded", { status: 404 });
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
							request.url.endsWith(
								`/issues/${recorded.number}/dependencies/blocked_by`,
							),
						),
					).toBe(true);
					closed = true;
					const events = notificationEvent(base);
					await Bun.sleep(50);
					await refresh(base);
					const event = await events;
					expect(event).toMatchObject({
						trigger: "blockerCleared",
						project: repo,
						key: outsideKey,
						text: dependency.title,
					});
					expect(await inboxOf(base)).toEqual([event]);
					expect(
						requests.filter((request) =>
							request.url.endsWith(
								`/issues/${recorded.number}/dependencies/blocked_by`,
							),
						).length,
					).toBe(2);
					const dependencyReads = requests.filter((request) =>
						request.url.endsWith("/dependencies/blocked_by"),
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
			if (url.endsWith(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				return Response.json([
					{
						...dependency,
						title: "   ",
						state: phase === "closed" ? "closed" : dependency.state,
					},
				]);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return new Response("not recorded", { status: 404 });
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
					phase = "closed";
					const events = notificationEvent(base);
					await Bun.sleep(50);
					await refresh(base);
					const event = await events;
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
			if (url.endsWith(`/issues/${recorded.number}/dependencies/blocked_by`)) {
				if (failed) {
					return new Response("not recorded", { status: 404 });
				}
				return Response.json([dependency]);
			}
			if (url.includes("/pulls?") || url.includes("/branches?")) {
				return Response.json([]);
			}
			if (url.includes("/comments")) {
				return Response.json([]);
			}
			return new Response("not recorded", { status: 404 });
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
		const evidence = outsideRelations.blankTitleEvidence;
		expect(evidence.blankTitles).toBe(0);
		expect(evidence.scannedBlockRelations).toBeGreaterThan(0);
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

	test("a disabled trigger produces no event and no inbox entry", async () => {
		const headline = "Which bot should review this?";
		await withInbox(
			{
				...pinned,
				notificationTriggers: {
					needsYou: false,
					comment: true,
					blockerCleared: true,
				},
			},
			[],
			async (base, setIssues) => {
				setIssues([
					linearIssue(
						"PF-1",
						"Open ask",
						headline,
						[{ body: `${headline}\n\n${ask("pf-1")}` }],
						{},
						"2026-08-18T13:00:00.000Z",
					),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				const needs = await (
					await fetch(new URL("/api/needs-you", base))
				).json();
				expect(needs).toHaveLength(1);
			},
		);
	});

	test("a blank comment and a repeated poll add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{ body: "   ", createdAt: "2026-08-18T14:00:00.000Z" },
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("a blank stamp, an older comment and a same-time comment add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note on the same ask.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		await withInbox(
			pinned,
			[linearIssue("PF-1", "Open ask", headline, [askComment, note])],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ body: "   ", createdAt: "   " },
						{ body: "No time.", createdAt: "" },
						{
							body: "An older note.",
							createdAt: "2026-08-18T13:00:00.000Z",
						},
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ ...note, body: "Same time, new words." },
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
	});

	test("editing or deleting a comment adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note on the same ask.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		await withInbox(
			pinned,
			[linearIssue("PF-1", "Open ask", headline, [askComment, note])],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue("PF-1", "Open ask", headline, [
						askComment,
						{ ...note, body: "A later note, edited." },
					]),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setIssues([linearIssue("PF-1", "Open ask", headline, [askComment])]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
	});

	test("a reply that answers the open ask adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("an agent comment after Lev's reply produces an inbox entry", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[
				{
					body: `${headline}\n\n${ask("pf-1")}`,
					createdAt: "2026-08-18T12:00:00.000Z",
				},
			],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
					],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						{
							body: `${headline}\n\n${ask("pf-1")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
						},
						{
							body: "Reply: use the review bot.",
							createdAt: "2026-08-18T14:00:00.000Z",
							user: { name: "AbysmalBiscuit" },
						},
						{
							body: "The review bot is running.",
							createdAt: "2026-08-18T15:00:00.000Z",
							user: { name: "workcell" },
						},
					],
					{},
					"2026-08-18T15:00:00.000Z",
				),
			]);
			const events = notificationEvent(base);
			await Bun.sleep(50);
			await refresh(base);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
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

	test("a restart does not notify a viewer-assigned label item as new", async () => {
		const headline = "Assigned label";
		const issue = linearIssue(
			"PF-9",
			headline,
			"Waiting on the viewer.",
			[],
			{
				labels: { nodes: [{ name: "needs-human" }] },
				assignee: { id: "viewer-ada", name: "Ada Lovelace" },
			},
			"2026-08-18T13:00:00.000Z",
		);
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues([issue]);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				...pinned,
				needsYouLabels: ["needs-human"],
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const io = {
			env: { LINEAR_API_KEY: "recorded-linear-key" },
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
		};
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, stdout, waitForStop: checks }),
			);
		try {
			let stopFirst: () => void = () => {};
			const firstStop = new Promise<void>((resolve) => {
				stopFirst = resolve;
			});
			let ready: (base: string) => void = () => {};
			const first = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await first;
			expect(await inboxOf(base)).toEqual([]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([
				expect.objectContaining({
					key: "PF-9",
					reason: "label",
					headline,
				}),
			]);
			stopFirst();
			await started;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let again: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				again = resolve;
			});
			const restarted = start(secondStop, again);
			const next = await second;
			await refresh(next);
			expect(await inboxOf(next)).toEqual([]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a restart on the same store does not notify the stored needs-you item again", async () => {
		const headline = "Which bot should review this?";
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[{ body: `${headline}\n\n${ask("pf-1")}` }],
			{},
			"2026-08-18T13:00:00.000Z",
		);
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues([issue]);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const io = {
			env: { LINEAR_API_KEY: "recorded-linear-key" },
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
		};
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, stdout, waitForStop: checks }),
			);
		try {
			let stopFirst: () => void = () => {};
			const firstStop = new Promise<void>((resolve) => {
				stopFirst = resolve;
			});
			let ready: (base: string) => void = () => {};
			const first = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await first;
			expect(await inboxOf(base)).toEqual([]);
			stopFirst();
			await started;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let again: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				again = resolve;
			});
			const restarted = start(secondStop, again);
			const next = await second;
			await refresh(next);
			expect(await inboxOf(next)).toEqual([]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a disabled comment trigger leaves a new comment out of the inbox", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const note = {
			body: "A later note.",
			createdAt: "2026-08-18T14:00:00.000Z",
		};
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		const commented = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment, note],
			{},
			"2026-08-18T14:00:00.000Z",
		);
		await withInbox(
			{
				...pinned,
				notificationTriggers: {
					needsYou: true,
					comment: false,
					blockerCleared: true,
				},
			},
			[issue],
			async (base, setIssues) => {
				setIssues([commented]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
		await withInbox(pinned, [issue], async (base, setIssues) => {
			setIssues([commented]);
			const events = notificationEvent(base);
			await Bun.sleep(50);
			await refresh(base);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "comment",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a project that misses the first poll records its needs-you items as seen", async () => {
		const headline = "Which bot should review this?";
		const issue = {
			...linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[{ body: `${headline}\n\n${ask("pf-1")}` }],
				{},
				"2026-08-18T12:00:00.000Z",
			),
			projectId: linearProject.id,
		};
		const held = {
			id: "project-held",
			name: "Held",
			slugId: "held",
		};
		let late = false;
		let joined = false;
		const joinedIssue = {
			...linearIssue(
				"PF-3",
				"Joined later",
				"Joined later",
				[{ body: `Joined later\n\n${ask("pf-3")}` }],
				{},
				"2026-08-18T16:00:00.000Z",
			),
			projectId: linearProject.id,
		};
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isPinQuery(input, init)) {
				const slug = bodyOf(init).match(/"pin":"([^"]+)"/)?.[1];
				const project =
					slug === held.slugId
						? held
						: slug === linearProject.slugId && late
							? linearProject
							: null;
				return Response.json({
					data: { projects: { nodes: project === null ? [] : [project] } },
				});
			}
			if (isIssueQuery(input, init)) {
				const projectId = bodyOf(init).match(
					/"project":\{"id":\{"eq":"([^"]+)"/,
				)?.[1];
				return recordedIssues(
					projectId === linearProject.id && late
						? joined
							? [issue, joinedIssue]
							: [issue]
						: [],
				);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: "held" },
					{ tracker: "linear", project: "project-flow" },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					expect(await inboxOf(base)).toEqual([]);
					late = true;
					await refresh(base);
					expect(await inboxOf(base)).toEqual([]);
					const listed = await fetch(new URL("/api/needs-you", base));
					expect(listed.status).toBe(200);
					expect(await listed.json()).toEqual([
						expect.objectContaining({ key: "PF-1", headline }),
					]);
					joined = true;
					const events = notificationEvent(base);
					await Bun.sleep(50);
					await refresh(base);
					const event = await events;
					expect(event).toMatchObject({
						trigger: "needsYou",
						project: "Project Flow",
						key: "PF-3",
						text: "Joined later",
					});
					expect(await inboxOf(base)).toEqual([event]);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
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

	test("a comment by the viewer adds no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const viewerName = `viewer-${crypto.randomUUID()}`;
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
			user: { name: "Ada Lovelace" },
		};
		const viewerNote = {
			body: "A later note from the viewer.",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "Not A Login", displayName: viewerName },
		};
		const otherNote = {
			body: "A later note from someone else.",
			createdAt: "2026-08-18T15:00:00.000Z",
			user: { name: "Ada Lovelace" },
		};
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(current);
			}
			const response = await recorded(input, init);
			if (!bodyOf(init).includes("viewer")) {
				return response;
			}
			const page = (await response.json()) as {
				data?: { viewer?: { id?: string } };
			};
			if (page.data?.viewer !== undefined) {
				page.data.viewer.id = viewerName;
			}
			return Response.json(page);
		};
		let current = [linearIssue("PF-1", "Open ask", headline, [askComment])];
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const done = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					expect(viewerName).not.toBe("viewer-ada");
					expect(await inboxOf(base)).toEqual([]);
					current = [
						linearIssue("PF-1", "Open ask", headline, [
							askComment,
							{
								body: "A note with a blank author.",
								createdAt: "2026-08-18T13:30:00.000Z",
								user: { name: "   ", displayName: "" },
							},
							{
								body: "   ",
								createdAt: "2026-08-18T13:00:00.000Z",
								user: { name: "   ", displayName: "   " },
							},
							viewerNote,
						]),
					];
					await refresh(base);
					expect(await inboxOf(base)).toEqual([]);
					current = [
						linearIssue(
							"PF-1",
							"Open ask",
							headline,
							[askComment, viewerNote, otherNote],
							{},
							"2026-08-18T15:00:00.000Z",
						),
					];
					const events = notificationEvent(base);
					await Bun.sleep(50);
					await refresh(base);
					const event = await events;
					expect(event).toMatchObject({
						trigger: "comment",
						project: "Project Flow",
						key: "PF-1",
						text: headline,
					});
					expect(await inboxOf(base)).toEqual([event]);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
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

	test("a blank reply, a repeated-space reply and a failing comment page add no inbox entry", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [issue], async (base, setIssues, failComments) => {
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, { body: "", createdAt: "2026-08-18T14:00:00.000Z" }],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[
						askComment,
						{ body: "Reply:   ", createdAt: "2026-08-18T15:00:00.000Z" },
					],
					{},
					"2026-08-18T15:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			failComments(true);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
		});
	});

	test("a ticket that leaves needs-you and joins again raises a notification", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const open = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[askComment],
			{},
			"2026-08-18T12:00:00.000Z",
		);
		await withInbox(pinned, [open], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([]);
			const again = {
				body: `${headline}\n\n${ask("pf-2")}`,
				createdAt: "2026-08-18T16:00:00.000Z",
			};
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			]);
			const events = notificationEvent(base);
			await Bun.sleep(50);
			await refresh(base);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(base)).toEqual([event]);
			const rejoined = await fetch(new URL("/api/needs-you", base));
			expect(rejoined.status).toBe(200);
			expect(await rejoined.json()).toEqual([
				expect.objectContaining({
					key: "PF-1",
					reason: "ask",
					headline,
				}),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([event]);
		});
	});

	test("a restart after a ticket leaves needs-you still raises the rejoin", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-08-18T16:00:00.000Z",
		};
		let current = [
			linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[askComment],
				{},
				"2026-08-18T12:00:00.000Z",
			),
		];
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(current);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const io = {
			env: { LINEAR_API_KEY: "recorded-linear-key" },
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
		};
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, stdout, waitForStop: checks }),
			);
		try {
			let stopFirst: () => void = () => {};
			const firstStop = new Promise<void>((resolve) => {
				stopFirst = resolve;
			});
			let ready: (base: string) => void = () => {};
			const first = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await first;
			expect(await inboxOf(base)).toEqual([]);
			current = [
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			];
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			stopFirst();
			await started;
			current = [
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			];
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const restarted = start(secondStop, againReady);
			const next = await second;
			const events = notificationEvent(next);
			await Bun.sleep(50);
			await refresh(next);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(await inboxOf(next)).toEqual([event]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a stored needsYou notification id still lets a rejoin notify after restart", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-08-18T16:00:00.000Z",
		};
		let current = [
			linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[askComment],
				{},
				"2026-08-18T12:00:00.000Z",
			),
		];
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(current);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const io = {
			env: { LINEAR_API_KEY: "recorded-linear-key" },
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
		};
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, stdout, waitForStop: checks }),
			);
		try {
			let stopFirst: () => void = () => {};
			const firstStop = new Promise<void>((resolve) => {
				stopFirst = resolve;
			});
			let ready: (base: string) => void = () => {};
			const first = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await first;
			expect(await inboxOf(base)).toEqual([]);
			current = [
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			];
			await refresh(base);
			expect(await inboxOf(base)).toEqual([]);
			stopFirst();
			await started;
			const legacy = new Database(databasePath);
			legacy.run(
				"insert into notifications (id, trigger, project, item_key, text, at) values (?, ?, ?, ?, ?, ?)",
				[
					"needsYou\nProject Flow\nPF-1",
					"needsYou",
					"Project Flow",
					"PF-1",
					headline,
					"2026-08-18T12:00:00.000Z",
				],
			);
			legacy.close();
			current = [
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			];
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const restarted = start(secondStop, againReady);
			const next = await second;
			const events = notificationEvent(next);
			await Bun.sleep(50);
			await refresh(next);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			const needsYou = (await inboxOf(next)).filter(
				(entry) =>
					entry.trigger === "needsYou" &&
					entry.id !== "needsYou\nProject Flow\nPF-1",
			);
			expect(needsYou).toEqual([event]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a stored needsYou id for an item still in needs-you raises no notification after an upgrade restart", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const current = [
			linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[askComment],
				{},
				"2026-08-18T12:00:00.000Z",
			),
		];
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(current);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const legacy = new Database(databasePath);
		legacy.run(`
			create table if not exists notifications (
				id text primary key,
				trigger text not null,
				project text not null,
				item_key text not null,
				text text not null,
				at text not null
			)
		`);
		legacy.run(
			"insert into notifications (id, trigger, project, item_key, text, at) values (?, ?, ?, ?, ?, ?)",
			[
				"needsYou\nProject Flow\nPF-1",
				"needsYou",
				"Project Flow",
				"PF-1",
				headline,
				"2026-08-18T12:00:00.000Z",
			],
		);
		legacy.close();
		const io = {
			env: { LINEAR_API_KEY: "recorded-linear-key" },
			fetch: fetchImpl,
			readGhToken: async () => null,
			databasePath,
		};
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({ ...io, stdout, waitForStop: checks }),
			);
		try {
			let stopFirst: () => void = () => {};
			const firstStop = new Promise<void>((resolve) => {
				stopFirst = resolve;
			});
			let ready: (base: string) => void = () => {};
			const first = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await first;
			await Bun.sleep(50);
			expect(await inboxOf(base)).toEqual([
				expect.objectContaining({
					id: "needsYou\nProject Flow\nPF-1",
					trigger: "needsYou",
					key: "PF-1",
				}),
			]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([
				expect.objectContaining({
					key: "PF-1",
					reason: "ask",
					headline,
				}),
			]);
			stopFirst();
			await started;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const restarted = start(secondStop, againReady);
			const next = await second;
			const hiddenConfig = {
				...pinned,
				hidden: [{ tracker: "linear", project: "project-flow" }],
			};
			await Bun.write(path, JSON.stringify(hiddenConfig));
			const hiddenEvents = notificationEvent(next, 400);
			await Bun.sleep(50);
			await refresh(next);
			await expect(hiddenEvents).rejects.toThrow(
				"no notification event within",
			);
			const hiddenList = await fetch(new URL("/api/needs-you", next));
			expect(hiddenList.status).toBe(200);
			expect(await hiddenList.json()).toEqual([]);
			expect(await inboxOf(next)).toEqual([
				expect.objectContaining({
					id: "needsYou\nProject Flow\nPF-1",
					trigger: "needsYou",
				}),
			]);
			await Bun.write(path, JSON.stringify(pinned));
			const shown = notificationEvent(next, 400);
			await Bun.sleep(50);
			await refresh(next);
			await expect(shown).rejects.toThrow("no notification event within");
			expect(await inboxOf(next)).toEqual([
				expect.objectContaining({
					id: "needsYou\nProject Flow\nPF-1",
					trigger: "needsYou",
					key: "PF-1",
				}),
			]);
			const shownList = await fetch(new URL("/api/needs-you", next));
			expect(shownList.status).toBe(200);
			expect(await shownList.json()).toEqual([
				expect.objectContaining({
					key: "PF-1",
					reason: "ask",
					headline,
				}),
			]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a ticket that stays in needs-you raises no second notification", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		await withInbox(
			pinned,
			[
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment],
					{},
					"2026-08-18T12:00:00.000Z",
				),
			],
			async (base, setIssues) => {
				expect(await inboxOf(base)).toEqual([]);
				setIssues([
					linearIssue(
						"PF-1",
						"Open ask",
						headline,
						[
							askComment,
							{
								body: "Still waiting.",
								createdAt: "2026-08-18T13:00:00.000Z",
							},
						],
						{},
						"2026-08-18T13:00:00.000Z",
					),
				]);
				await refresh(base);
				const first = await inboxOf(base);
				expect(first).toHaveLength(1);
				expect(first[0]).toMatchObject({ trigger: "comment", key: "PF-1" });
				await refresh(base);
				expect(await inboxOf(base)).toEqual(first);
			},
		);
	});

	test("an idle project that shows again raises no second notification, and a leave and rejoin on a loaded project does", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-06-01T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-06-01T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-06-01T16:00:00.000Z",
		};
		const idle = {
			id: "project-idle",
			name: "Idle",
			slugId: "idle",
			updatedAt: "2026-06-01T12:00:00.000Z",
		};
		const loaded = {
			id: "project-loaded",
			name: "Loaded",
			slugId: "loaded",
			updatedAt: "2026-10-18T12:00:00.000Z",
		};
		const openOn = (
			project: typeof idle,
			identifier: string,
			comments: {
				body: string;
				createdAt?: string;
				user?: { name: string };
			}[],
			updatedAt: string,
		) => ({
			...linearIssue(identifier, "Open ask", headline, comments, {}, updatedAt),
			projectId: project.id,
		});
		let current = [
			openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
			openOn(loaded, "LOAD-1", [askComment], "2026-10-18T12:00:00.000Z"),
		];
		const recorded = linearFake({ project: null });
		const fetchImpl: Fetch = async (input, init) => {
			if (
				urlOf(input) === "https://api.linear.app/graphql" &&
				bodyOf(init).includes("MemberProjects")
			) {
				return Response.json({
					data: {
						viewer: { id: "viewer-ada" },
						projects: {
							nodes: [idle, loaded],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				});
			}
			if (isIssueQuery(input, init)) {
				const projectId = bodyOf(init).match(
					/"project":\{"id":\{"eq":"([^"]+)"/,
				)?.[1];
				return recordedIssues(
					current.filter((issue) => issue.projectId === projectId),
				);
			}
			if (isPinQuery(input, init)) {
				const slug = bodyOf(init).match(/"pin":"([^"]+)"/)?.[1];
				const project =
					[idle, loaded].find((item) => item.slugId === slug) ?? null;
				return Response.json({
					data: { projects: { nodes: project === null ? [] : [project] } },
				});
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: "idle" },
					{ tracker: "linear", project: "loaded" },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		try {
			let stop: () => void = () => {};
			const stopped = new Promise<void>((resolve) => {
				stop = resolve;
			});
			let ready: (base: string) => void = () => {};
			const started = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => ready(line),
					waitForStop: stopped,
				}),
			);
			const base = await started;
			expect(await inboxOf(base)).toEqual([]);
			const listed = await fetch(new URL("/api/needs-you", base));
			expect(listed.status).toBe(200);
			expect(await listed.json()).toEqual([
				expect.objectContaining({ project: "Idle", key: "IDLE-1" }),
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			const shownConfig = {
				pinned: [
					{ tracker: "linear", project: "idle" },
					{ tracker: "linear", project: "loaded" },
				],
				pollIntervalSeconds: 3600,
				checkoutRoots: [],
			};
			const hiddenConfig = {
				...shownConfig,
				hidden: [{ tracker: "linear", project: "idle" }],
			};
			await Bun.write(path, JSON.stringify(hiddenConfig));
			await refresh(base);
			const hiddenList = await fetch(new URL("/api/needs-you", base));
			expect(hiddenList.status).toBe(200);
			expect(await hiddenList.json()).toEqual([
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			expect(await inboxOf(base)).toEqual([]);
			stop();
			await running;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const second = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const restarted = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => againReady(line),
					waitForStop: secondStop,
				}),
			);
			const next = await second;
			const hiddenAgain = await fetch(new URL("/api/needs-you", next));
			expect(hiddenAgain.status).toBe(200);
			expect(await hiddenAgain.json()).toEqual([
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			await Bun.write(path, JSON.stringify(shownConfig));
			const shown = notificationEvent(next, 400);
			await Bun.sleep(50);
			await refresh(next);
			await expect(shown).rejects.toThrow("no notification event");
			expect(await inboxOf(next)).toEqual([]);
			await refresh(next);
			const shownList = await fetch(new URL("/api/needs-you", next));
			expect(shownList.status).toBe(200);
			expect(await shownList.json()).toEqual([
				expect.objectContaining({ project: "Idle", key: "IDLE-1" }),
				expect.objectContaining({ project: "Loaded", key: "LOAD-1" }),
			]);
			current = [
				openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
				openOn(
					loaded,
					"LOAD-1",
					[askComment, reply],
					"2026-10-18T14:00:00.000Z",
				),
			];
			await refresh(next);
			expect(await inboxOf(next)).toEqual([]);
			current = [
				openOn(idle, "IDLE-1", [askComment], "2026-06-01T12:00:00.000Z"),
				openOn(
					loaded,
					"LOAD-1",
					[askComment, reply, again],
					"2026-10-18T16:00:00.000Z",
				),
			];
			const events = notificationEvent(next);
			await Bun.sleep(50);
			await refresh(next);
			const event = await events;
			expect(event).toMatchObject({
				trigger: "needsYou",
				project: "Loaded",
				key: "LOAD-1",
				text: headline,
			});
			expect(await inboxOf(next)).toEqual([event]);
			stopSecond();
			await restarted;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);

	test("a ticket that joins, leaves and joins again raises two needs-you notifications", async () => {
		const headline = "Which bot should review this?";
		const askComment = {
			body: `${headline}\n\n${ask("pf-1")}`,
			createdAt: "2026-08-18T12:00:00.000Z",
		};
		const reply = {
			body: "Reply: use the review bot.\n\npf-1",
			createdAt: "2026-08-18T14:00:00.000Z",
			user: { name: "AbysmalBiscuit" },
		};
		const again = {
			body: `${headline}\n\n${ask("pf-2")}`,
			createdAt: "2026-08-18T16:00:00.000Z",
		};
		await withInbox(pinned, [], async (base, setIssues) => {
			expect(await inboxOf(base)).toEqual([]);
			const joined = notificationEvent(base);
			await Bun.sleep(50);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment],
					{},
					"2026-08-18T12:00:00.000Z",
				),
			]);
			await refresh(base);
			const first = await joined;
			expect(first).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply],
					{},
					"2026-08-18T14:00:00.000Z",
				),
			]);
			await refresh(base);
			expect(await inboxOf(base)).toEqual([first]);
			const rejoined = notificationEvent(base);
			await Bun.sleep(50);
			setIssues([
				linearIssue(
					"PF-1",
					"Open ask",
					headline,
					[askComment, reply, again],
					{},
					"2026-08-18T16:00:00.000Z",
				),
			]);
			await refresh(base);
			const second = await rejoined;
			expect(second).toMatchObject({
				trigger: "needsYou",
				project: "Project Flow",
				key: "PF-1",
				text: headline,
			});
			expect(second.id).not.toBe(first.id);
			expect(await inboxOf(base)).toEqual([second, first]);
		});
	});
});

const githubRepo = "acme/widget";

function githubPage(items: unknown): Response {
	return Response.json(items);
}

function githubIssue(
	number: number,
	comments: number,
): Record<string, unknown> {
	return {
		number,
		title: "Ship the signing key",
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body: "",
		comments,
		assignee: null,
		labels: [],
	};
}

function githubPull(number: number, body: string): Record<string, unknown> {
	return {
		number,
		title: "Count PR asks",
		state: "open",
		draft: false,
		html_url: `https://github.com/${githubRepo}/pull/${number}`,
		head: { ref: `${number}-feat-pr-ask`, sha: `sha-${number}` },
		body,
		merged_at: null,
	};
}

function githubComment(
	body: string,
	createdAt: string,
	login = "agent",
): Record<string, unknown> {
	return {
		body,
		created_at: createdAt,
		user: { login },
	};
}

async function withGithubInbox(
	issueComments: Record<number, Record<string, unknown>[]>,
	pullComments: Record<number, Record<string, unknown>[]>,
	checks: (
		base: string,
		setComments: (next: {
			issues: Record<number, Record<string, unknown>[]>;
			pulls: Record<number, Record<string, unknown>[]>;
		}) => void,
	) => Promise<void>,
	issues: Record<string, unknown>[] = [githubIssue(8, 0)],
	pulls: Record<string, unknown>[] = [githubPull(49, "Closes #8")],
): Promise<void> {
	let currentIssues = issueComments;
	let currentPulls = pullComments;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return githubPage({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql") {
			return githubPage({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			});
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return githubPage(issues);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=100&page=1`
		) {
			return githubPage(pulls);
		}
		const comments = url.match(
			/\/issues\/(\d+)\/comments\?per_page=100&page=1$/,
		);
		if (comments?.[1] !== undefined) {
			const number = Number(comments[1]);
			const onIssue = currentIssues[number];
			if (onIssue !== undefined) {
				return githubPage(onIssue);
			}
			const onPull = currentPulls[number];
			if (onPull !== undefined) {
				return githubPage(onPull);
			}
		}
		if (
			url.includes("/pulls?state=closed") ||
			url.includes("/branches?") ||
			url.includes("/comments?") ||
			url.includes("/reviews?") ||
			url.includes("/reactions?") ||
			url.includes("/check-runs") ||
			url.includes("/commits/")
		) {
			return url.includes("/check-runs")
				? Response.json({ check_runs: [] })
				: url.includes("/commits/")
					? Response.json({
							commit: { committer: { date: "2026-10-01T00:00:00Z" } },
						})
					: githubPage([]);
		}
		return new Response("not recorded", { status: 404 });
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			checks(base, (next) => {
				currentIssues = next.issues;
				currentPulls = next.pulls;
			}).then(resolve, reject);
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
}

describe("inbox pull comments", () => {
	test("a new comment on a linked PR raises New comment for its ticket", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				const listed = await fetch(new URL("/api/needs-you", base));
				expect(listed.status).toBe(200);
				expect(await listed.json()).toEqual([
					expect.objectContaining({
						key: `${githubRepo}#8`,
						reason: "ask",
						headline,
					}),
				]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the linked PR.",
								"2026-10-01T02:00:00Z",
							),
						],
					},
				});
				const events = notificationEvent(base);
				await Bun.sleep(50);
				await refresh(base);
				const event = await events;
				expect(event).toMatchObject({
					trigger: "comment",
					project: githubRepo,
					key: `${githubRepo}#8`,
					text: headline,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
		);
	});

	test("a new comment on a PR ask raises New comment", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				const listed = await fetch(new URL("/api/needs-you", base));
				expect(listed.status).toBe(200);
				expect(await listed.json()).toEqual([
					expect.objectContaining({
						key: `${githubRepo}#49`,
						reason: "ask",
						headline,
					}),
				]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the PR ask.",
								"2026-10-01T02:00:00Z",
							),
						],
					},
				});
				const events = notificationEvent(base);
				await Bun.sleep(50);
				await refresh(base);
				const event = await events;
				expect(event).toMatchObject({
					trigger: "comment",
					project: githubRepo,
					key: `${githubRepo}#49`,
					text: headline,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
			[],
			[githubPull(49, "A fix with no ticket.")],
		);
	});

	test("a blank linked PR comment and the viewer's own PR comment add no inbox entry", async () => {
		const headline = "This waits on Lev for the signing key.";
		const askComment = githubComment(
			`${headline}\n\n${ask("pr-49")}`,
			"2026-10-01T00:00:00Z",
		);
		await withGithubInbox(
			{},
			{ 49: [askComment] },
			async (base, setComments) => {
				expect(await inboxOf(base)).toEqual([]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment("   ", "2026-10-01T01:00:00Z"),
							githubComment(
								"A note from the viewer.",
								"2026-10-01T02:00:00Z",
								"lev",
							),
						],
					},
				});
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
				setComments({
					issues: {},
					pulls: {
						49: [
							askComment,
							githubComment(
								"A later note on the linked PR.",
								"2026-10-01T03:00:00Z",
							),
						],
					},
				});
				const events = notificationEvent(base);
				await Bun.sleep(50);
				await refresh(base);
				const event = await events;
				expect(event).toMatchObject({
					trigger: "comment",
					key: `${githubRepo}#8`,
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
		);
	});
});
