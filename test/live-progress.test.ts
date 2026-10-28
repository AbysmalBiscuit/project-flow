import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { goodPoll, tempConfig, testIo } from "./support/app.ts";
import { urlOf } from "./support/fetch.ts";
import {
	issuesResponse,
	listedRead,
	otherRepo,
	page,
	recordedDiscovery,
	recordedOrEmpty,
	repo,
	ticket,
	unrecorded,
} from "./support/github.ts";
import { openEventStream, type OverviewBody } from "./support/reads.ts";

type ProgressEvent = {
	done: number;
	total: number;
	project: string | null;
	ended: boolean;
};

async function nextProgress(
	events: AsyncIterator<{ event: string; data: string } | undefined>,
	endedOnly = false,
): Promise<ProgressEvent> {
	while (true) {
		const received = await events.next();
		if (received.done) {
			break;
		}
		if (received.value?.event !== "progress") {
			continue;
		}
		const progress = JSON.parse(received.value.data) as ProgressEvent;
		if (!endedOnly || progress.ended) {
			return progress;
		}
	}
	throw new Error("the held poll sent no progress");
}

test("an empty store answers that the poll is running before it ends", async () => {
	let releasePoll: () => void = () => {};
	const pollHeld = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			await pollHeld;
			return discovered;
		}
		if (listedRead(input, init)?.repo === repo) {
			return (
				issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
				page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects).toEqual([]);
				expect(body.polling).toBe(true);
				expect(body.error).toBeNull();
				releasePoll();
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releasePoll();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

test("a held poll sends progress with the projects done and a final event", async () => {
	const second = otherRepo;
	let releaseFirst: () => void = () => {};
	let releaseSecond: () => void = () => {};
	const firstHeld = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const secondHeld = new Promise<void>((resolve) => {
		releaseSecond = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const listed = listedRead(input, init);
		if (listed?.repo === repo) {
			await firstHeld;
			return (
				issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
				page([])
			);
		}
		if (listed?.repo === second) {
			await secondHeld;
			return (
				issuesResponse(
					input,
					init,
					[ticket(2, "2026-04-01T00:00:00Z")],
					second,
				) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo },
				{ tracker: "github", repo: second },
			],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const stream = openEventStream(base);
				await stream.ready;
				const events = stream.events[Symbol.asyncIterator]();
				expect(await nextProgress(events)).toEqual({
					done: 0,
					total: 2,
					project: repo,
					ended: false,
				});
				const joined = openEventStream(base);
				await joined.ready;
				expect(
					await nextProgress(joined.events[Symbol.asyncIterator]()),
				).toEqual({
					done: 0,
					total: 2,
					project: repo,
					ended: false,
				});
				joined.close();
				releaseFirst();
				expect(await nextProgress(events)).toEqual({
					done: 1,
					total: 2,
					project: second,
					ended: false,
				});
				releaseSecond();
				expect(await nextProgress(events)).toEqual({
					done: 2,
					total: 2,
					project: null,
					ended: true,
				});
				stream.close();
				joined.close();
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releaseFirst();
		releaseSecond();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

test("a poll of a blank tracked list sends a final progress event", async () => {
	let releaseDiscovery: () => void = () => {};
	const discoveryHeld = new Promise<void>((resolve) => {
		releaseDiscovery = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			await discoveryHeld;
			return discovered;
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned: [], pollIntervalSeconds: 3600 }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const stream = openEventStream(base);
				await stream.ready;
				const events = stream.events[Symbol.asyncIterator]();
				releaseDiscovery();
				expect(await nextProgress(events, true)).toEqual({
					done: 0,
					total: 0,
					project: null,
					ended: true,
				});
				stream.close();
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releaseDiscovery();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

test("a poll that rejects still sends a final progress event", async () => {
	let releaseRead: () => void = () => {};
	const readHeld = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const listed = listedRead(input, init);
		if (listed?.repo === repo) {
			await readHeld;
			await Bun.write(path, "{\n");
			return new Response("poll rejected", { status: 500 });
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let releaseStop: () => void = () => {};
	const stop = new Promise<void>((resolve) => {
		releaseStop = resolve;
	});
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const stream = openEventStream(base);
				await stream.ready;
				const events = stream.events[Symbol.asyncIterator]();
				const started = await nextProgress(events);
				expect(started.ended).toBe(false);
				releaseRead();
				expect(await nextProgress(events, true)).toEqual({
					done: 1,
					total: 1,
					project: null,
					ended: true,
				});
				stream.close();
				resolve();
			})().catch(reject);
		};
	});
	const running = run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo(
			{
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date(goodPoll),
				stdout: (line) => startChecks(line),
				waitForStop: stop,
			},
			{ first: true },
		),
	);
	try {
		await checks;
		const failed = await running;
		expect(failed.exitCode).toBe(1);
		expect(failed.stderr).toContain(
			"invalid configuration: configuration is not JSON",
		);
	} finally {
		releaseRead();
		releaseStop();
		await running.catch(() => {});
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});

test("the overview answers while a slow first poll holds the tracker", async () => {
	let releasePoll: () => void = () => {};
	const pollHeld = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), {
				status: 200,
			});
		}
		await pollHeld;
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (listedRead(input, init)?.repo === repo) {
			return (
				issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
				page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [{ tracker: "github", repo }],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const response = await fetch(new URL("/api/overview", base));
				expect(response.status).toBe(200);
				const body = (await response.json()) as OverviewBody;
				expect(body.polling).toBe(true);
				expect(body.error).toBeNull();
				releasePoll();
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
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releasePoll();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);
