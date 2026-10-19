import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { linearFake, tempConfig, testIo, urlOf } from "./support.ts";

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

function notificationEvent(base: string): Promise<InboxEntry> {
	return new Promise((resolve, reject) => {
		let buffer = "";
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
							resolve(JSON.parse(payload) as InboxEntry);
						}
					}
				},
				error(_socket, error) {
					reject(error);
				},
				open(openSocket) {
					openSocket.write(
						"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
					);
				},
			},
		});
		setTimeout(() => {
			void socket.then((open) => open.end());
			reject(new Error("no notification event within 3000ms"));
		}, 3_000);
	});
}

async function withInbox(
	config: unknown,
	issues: Record<string, unknown>[],
	checks: (
		base: string,
		setIssues: (next: Record<string, unknown>[]) => void,
	) => Promise<void>,
	projects: { id: string; name: string; slugId: string }[] = [linearProject],
): Promise<void> {
	let current = issues;
	const recorded = linearFake({ project: projects[0] ?? linearProject });
	const fetchImpl: Fetch = async (input, init) => {
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
			checks(base, (next) => {
				current = next;
			}).then(resolve, reject);
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
		let issues: Record<string, unknown>[] = [];
		const recorded = linearFake({ project: linearProject });
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				return recordedIssues(issues);
			}
			return recorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "project-flow" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					const empty = await fetch(new URL("/api/inbox", base));
					expect(empty.status).toBe(200);
					expect(await empty.json()).toEqual([]);

					issues = [
						linearIssue(
							"PF-1",
							"Open ask",
							headline,
							[{ body: `${headline}\n\n${ask("pf-1")}` }],
							{},
							"2026-08-18T13:00:00.000Z",
						),
					];
					const events = notificationEvent(base);
					await Bun.sleep(50);
					const refreshed = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refreshed.status).toBe(204);
					const event = await events;
					expect(event.trigger).toBe("needsYou");
					expect(event.key).toBe("PF-1");
					expect(event.text).toBe(headline);

					const inbox = (await (
						await fetch(new URL("/api/inbox", base))
					).json()) as InboxEntry[];
					expect(inbox).toEqual([
						{
							id: event.id,
							trigger: "needsYou",
							project: "Project Flow",
							key: "PF-1",
							text: headline,
							at: event.at,
						},
					]);
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
		const gate = {
			id: "project-gate",
			name: "Gate",
			slugId: "gate",
		};
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
				"Open the gate",
				"",
				[],
				{ state: { type: "started" } },
				"2026-08-18T12:00:00.000Z",
			),
			projectId: gate.id,
		};
		await withInbox(
			{
				pinned: [
					{ tracker: "linear", project: "project-flow" },
					{ tracker: "linear", project: "gate" },
				],
				pollIntervalSeconds: 3600,
			},
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
					text: "Open the gate",
				});
				expect(await inboxOf(base)).toEqual([event]);
			},
			[linearProject, gate],
		);
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

	test("dropping the blocker line without closing the ticket adds no inbox entry", async () => {
		const gate = {
			id: "project-gate",
			name: "Gate",
			slugId: "gate",
		};
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
				"Open the gate",
				"",
				[],
				{ state: { type: "started" } },
				"2026-08-18T12:00:00.000Z",
			),
			projectId: gate.id,
		};
		await withInbox(
			{
				pinned: [
					{ tracker: "linear", project: "project-flow" },
					{ tracker: "linear", project: "gate" },
				],
				pollIntervalSeconds: 3600,
			},
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
		const issue = linearIssue(
			"PF-1",
			"Open ask",
			headline,
			[{ body: `${headline}\n\n${ask("pf-1")}` }],
			{},
			"2026-08-18T12:00:00.000Z",
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
				setIssues([
					linearIssue(
						"PF-1",
						"Open ask",
						headline,
						[
							{ body: `${headline}\n\n${ask("pf-1")}` },
							{ body: "A later note." },
						],
						{},
						"2026-08-18T14:00:00.000Z",
					),
				]);
				await refresh(base);
				expect(await inboxOf(base)).toEqual([]);
			},
		);
	});
});
