import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { sqliteStore } from "../../src/store.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { linearFake } from "../support/linear.ts";
import {
	ask,
	type InboxEntry,
	inboxOf,
	isIssueQuery,
	linearIssue,
	linearProject,
	markRead,
	pinned,
	recordedIssues,
	refresh,
} from "./_support.ts";

describe("inbox", () => {
	test("marking one entry read survives a restart while another stays unread", async () => {
		let current = [
			linearIssue(
				"PF-1",
				"Open ask",
				"Which bot should review this?",
				[
					{
						body: `Which bot should review this?\n\n${ask("pf-1")}`,
					},
				],
				{},
				"2026-08-18T13:00:00.000Z",
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
			const opened = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await opened;
			expect(await inboxOf(base)).toEqual([]);
			current = [
				...current,
				linearIssue(
					"PF-2",
					"Second ask",
					"Second question",
					[{ body: `Second question\n\n${ask("pf-2")}` }],
					{},
					"2026-08-18T13:05:00.000Z",
				),
			];
			await refresh(base);
			const first = await inboxOf(base);
			expect(first).toHaveLength(1);
			expect(first[0]?.key).toBe("PF-2");
			current = [
				...current,
				linearIssue(
					"PF-3",
					"Third ask",
					"Third question",
					[{ body: `Third question\n\n${ask("pf-3")}` }],
					{},
					"2026-08-18T13:10:00.000Z",
				),
			];
			await refresh(base);
			const entries = await inboxOf(base);
			expect(entries).toHaveLength(2);
			expect(entries.every((entry) => !entry.read)).toBe(true);
			const marked = entries[0];
			const other = entries[1];
			if (marked === undefined || other === undefined) {
				throw new Error("expected two inbox entries");
			}
			const response = await markRead(base, marked.id);
			expect(response.status).toBe(204);
			stopFirst();
			await started;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const restarted = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const resumed = start(secondStop, againReady);
			const next = await restarted;
			const kept = await inboxOf(next);
			expect(kept.map((entry) => entry.id)).toEqual(
				entries.map((entry) => entry.id),
			);
			expect(kept.find((entry) => entry.id === marked.id)?.read).toBe(true);
			expect(kept.find((entry) => entry.id === other.id)?.read).toBe(false);
			stopSecond();
			await resumed;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("marking every entry read survives a restart", async () => {
		const headline = "Which bot should review this?";
		let current = [
			linearIssue(
				"PF-1",
				"Open ask",
				headline,
				[{ body: `${headline}\n\n${ask("pf-1")}` }],
				{},
				"2026-08-18T13:00:00.000Z",
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
			const opened = new Promise<string>((resolve) => {
				ready = resolve;
			});
			const started = start(firstStop, ready);
			const base = await opened;
			expect(await inboxOf(base)).toEqual([]);
			current = [
				...current,
				linearIssue(
					"PF-2",
					"Second ask",
					"Second question",
					[{ body: `Second question\n\n${ask("pf-2")}` }],
					{},
					"2026-08-18T13:05:00.000Z",
				),
			];
			await refresh(base);
			current = [
				...current,
				linearIssue(
					"PF-3",
					"Third ask",
					"Third question",
					[{ body: `Third question\n\n${ask("pf-3")}` }],
					{},
					"2026-08-18T13:10:00.000Z",
				),
			];
			await refresh(base);
			const entries = await inboxOf(base);
			expect(entries).toHaveLength(2);
			expect(entries.every((entry) => !entry.read)).toBe(true);
			const blank = await markRead(base, " ");
			expect(blank.status).toBe(400);
			const missing = await markRead(base, "missing-entry");
			expect(missing.status).toBe(404);
			const repeated = await markRead(
				base,
				undefined,
				entries.map((entry) => entry.id),
			);
			expect(repeated.status).toBe(204);
			expect((await inboxOf(base)).every((entry) => entry.read)).toBe(true);
			const again = await markRead(
				base,
				undefined,
				entries.map((entry) => entry.id),
			);
			expect(again.status).toBe(204);
			stopFirst();
			await started;
			let stopSecond: () => void = () => {};
			const secondStop = new Promise<void>((resolve) => {
				stopSecond = resolve;
			});
			let againReady: (base: string) => void = () => {};
			const restarted = new Promise<string>((resolve) => {
				againReady = resolve;
			});
			const resumed = start(secondStop, againReady);
			const next = await restarted;
			const kept = await inboxOf(next);
			expect(kept.map((entry) => entry.id)).toEqual(
				entries.map((entry) => entry.id),
			);
			expect(kept.every((entry) => entry.read)).toBe(true);
			stopSecond();
			await resumed;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("inbox days follow the clock calendar, not the newest entry", async () => {
		const now = new Date(2026, 9, 20, 12, 0, 0);
		const rows = [
			{
				id: "earlier-row",
				trigger: "needsYou" as const,
				project: "Project Flow",
				tracker: "linear" as const,
				key: "PF-1",
				text: "Earlier question",
				at: new Date(2026, 9, 15, 9, 0, 0).toISOString(),
				read: false,
			},
			{
				id: "yesterday-row",
				trigger: "comment" as const,
				project: "Project Flow",
				tracker: "github" as const,
				key: "acme/widget#8",
				text: "Yesterday comment",
				at: new Date(2026, 9, 19, 9, 0, 0).toISOString(),
				read: false,
			},
			{
				id: "today-row",
				trigger: "needsYou" as const,
				project: "Project Flow",
				tracker: "linear" as const,
				key: "PF-3",
				text: "Today question",
				at: new Date(2026, 9, 20, 16, 12, 0).toISOString(),
				read: false,
			},
		];
		const recorded = linearFake({ project: linearProject });
		const { path, cleanup } = await tempConfig(JSON.stringify(pinned));
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "store.sqlite");
		const seeded = sqliteStore(databasePath);
		seeded.store.appendNotifications(rows);
		seeded.close();
		try {
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
					env: { LINEAR_API_KEY: "recorded-linear-key" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath,
					stdout: ready,
					waitForStop: stopped,
					now: () => now,
				}),
			);
			const base = await opened;
			const response = await fetch(new URL("/api/inbox", base));
			expect(response.status).toBe(200);
			const listed = (await response.json()) as InboxEntry[];
			expect(
				listed.map((entry) => [entry.id, entry.day, entry.tracker]),
			).toEqual([
				["today-row", "today", "linear"],
				["yesterday-row", "yesterday", "github"],
				["earlier-row", "earlier", "linear"],
			]);
			const hidden = await markRead(base, undefined, ["today-row"]);
			expect(hidden.status).toBe(204);
			const after = (await (
				await fetch(new URL("/api/inbox", base))
			).json()) as InboxEntry[];
			expect(after.find((entry) => entry.id === "today-row")?.read).toBe(true);
			expect(after.find((entry) => entry.id === "earlier-row")?.read).toBe(
				false,
			);
			const percent = await fetch(new URL("/api/inbox/100%25%20Done", base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ read: true }),
			});
			expect(percent.status).toBe(404);
			stop();
			await started;
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
