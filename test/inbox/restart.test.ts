import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { linearFake } from "../support/linear.ts";
import {
	ask,
	bodyOf,
	type InboxEntry,
	inboxOf,
	isIssueQuery,
	isPinQuery,
	linearIssue,
	linearProject,
	notificationAfterRefresh,
	pinned,
	quietUntil,
	recordedIssues,
	refresh,
} from "./_support.ts";

describe("inbox", () => {
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
					const event = await notificationAfterRefresh(base);
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
		let releaseIssues = () => {};
		let issuesHeld = Promise.resolve();
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				await issuesHeld;
				return recordedIssues(current);
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
			issuesHeld = new Promise<void>((resolve) => {
				releaseIssues = resolve;
			});
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
			const event = await notificationAfterRefresh(next, releaseIssues);
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
		let releaseIssues = () => {};
		let issuesHeld = Promise.resolve();
		const fetchImpl: Fetch = async (input, init) => {
			if (isIssueQuery(input, init)) {
				await issuesHeld;
				return recordedIssues(current);
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
			issuesHeld = new Promise<void>((resolve) => {
				releaseIssues = resolve;
			});
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
			const event = await notificationAfterRefresh(next, releaseIssues);
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

	test("stored notifications keep their tickets after an upgrade restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const legacy = new Database(databasePath);
		legacy.run(`
			create table notifications (
				id text primary key,
				trigger text not null,
				project text not null,
				item_key text not null,
				text text not null,
				at text not null,
				read integer not null default 0
			)
		`);
		const insert =
			"insert into notifications (id, trigger, project, item_key, text, at) values (?, ?, ?, ?, ?, ?)";
		legacy.run(insert, [
			"comment\nProject Flow\nacme/widget#8",
			"comment",
			"Project Flow",
			"acme/widget#8",
			"Pull comment",
			"2026-08-18T13:00:00.000Z",
		]);
		legacy.run(insert, [
			"needsYou\nProject Flow\nPF-1",
			"needsYou",
			"Project Flow",
			"PF-1",
			"Open ask",
			"2026-08-18T12:00:00.000Z",
		]);
		legacy.close();
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const start = (checks: Promise<void>, stdout: (line: string) => void) =>
			run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: linearFake({ project: linearProject }),
					readGhToken: async () => null,
					databasePath,
					stdout,
					waitForStop: checks,
				}),
			);
		const trackers = async (base: string) => {
			const response = await fetch(new URL("/api/inbox", base));
			expect(response.status).toBe(200);
			const entries = (await response.json()) as InboxEntry[];
			return entries.map((entry) => [entry.key, entry.tracker]);
		};
		const stored = [
			["acme/widget#8", "github"],
			["PF-1", "linear"],
		];
		try {
			for (let round = 0; round < 2; round += 1) {
				let stop: () => void = () => {};
				const stopped = new Promise<void>((resolve) => {
					stop = resolve;
				});
				let ready: (base: string) => void = () => {};
				const opened = new Promise<string>((resolve) => {
					ready = resolve;
				});
				const started = start(stopped, ready);
				expect(await trackers(await opened)).toEqual(stored);
				stop();
				await started;
			}
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
		const pinnedOffHome = { ...pinned, checkoutRoots: [] };
		const { path, cleanup } = await tempConfig(JSON.stringify(pinnedOffHome));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
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
			const untrackedConfig = { ...pinnedOffHome, tracked: [] };
			await Bun.write(path, JSON.stringify(untrackedConfig));
			await quietUntil(next, async () => {
				const listed = await fetch(new URL("/api/needs-you", next));
				expect(listed.status).toBe(200);
				return ((await listed.json()) as unknown[]).length === 0;
			});
			const hiddenList = await fetch(new URL("/api/needs-you", next));
			expect(hiddenList.status).toBe(200);
			expect(await hiddenList.json()).toEqual([]);
			expect(await inboxOf(next)).toEqual([
				expect.objectContaining({
					id: "needsYou\nProject Flow\nPF-1",
					trigger: "needsYou",
				}),
			]);
			await Bun.write(path, JSON.stringify(pinnedOffHome));
			await quietUntil(next, async () => {
				const listed = await fetch(new URL("/api/needs-you", next));
				expect(listed.status).toBe(200);
				return ((await listed.json()) as unknown[]).length === 1;
			});
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
	}, 30_000);
});
