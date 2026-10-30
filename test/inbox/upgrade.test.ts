import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { linearFake } from "../support/linear.ts";
import { type InboxEntry, linearProject, pinned } from "./_support.ts";

describe("inbox", () => {
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
});
