import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	goodPoll,
	issuesResponse,
	listedRead,
	listUrl,
	type OverviewBody,
	openEventStream,
	overviewOf,
	page,
	readOverview,
	recordedOrEmpty,
	repo,
	ticket,
	withServer,
} from "./live-support.ts";
import { answerRecordedRepoRead } from "./recorded-read.ts";
import {
	recordedDiscovery,
	settledOverview,
	settledOverviewEvent,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

test("a refresh during a poll longer than 10 seconds answers before that poll ends", async () => {
	// The poll span runs on the clock port, not wall time.
	const pollSpanMs = 11_000;
	let releasePoll: () => void = () => {};
	const pollHeld = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	let releaseFollowUp: () => void = () => {};
	const followUpHeld = new Promise<void>((resolve) => {
		releaseFollowUp = resolve;
	});
	let issueReads = 0;
	let pollReachedTracker = false;
	let followUpReachedTracker = false;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			issueReads += 1;
			if (issueReads > 1) {
				pollReachedTracker = true;
				await pollHeld;
				if (issueReads > 2) {
					followUpReachedTracker = true;
					await followUpHeld;
				}
				return page([
					ticket(1, "2026-04-02T00:00:00Z", "closed"),
					ticket(2, "2026-04-02T00:00:00Z"),
				]);
			}
			return page([ticket(1, "2026-04-01T00:00:00Z")]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	await withServer(fetchImpl, 3600, async (base, advance) => {
		const before = await readOverview(base);
		expect(before.polling).toBeUndefined();
		expect(before.fetchedAt).toBe(goodPoll);
		const stream = openEventStream(base);
		await stream.ready;
		const started = Date.now();
		const refresh = fetch(new URL("/api/refresh", base), { method: "POST" });
		const answered = await refresh;
		expect(answered.status).toBe(204);
		expect(Date.now() - started).toBeLessThan(10_000);
		while (!pollReachedTracker) {
			await Bun.sleep(20);
		}
		const joined = await fetch(new URL("/api/refresh", base), {
			method: "POST",
			body: "   ",
		});
		expect(joined.status).toBe(204);
		expect(Date.now() - started).toBeLessThan(10_000);
		expect(issueReads).toBe(2);
		const running = await readOverview(base);
		expect(running.polling).toBe(true);
		expect(running.fetchedAt).toBe(before.fetchedAt);
		const events = stream.events[Symbol.asyncIterator]();
		const runningEvent = await events.next();
		expect(runningEvent.done).toBe(false);
		if (!runningEvent.done && runningEvent.value !== undefined) {
			const startedPoll = overviewOf(runningEvent.value.data);
			expect(startedPoll.polling).toBe(true);
		}
		advance(pollSpanMs);
		expect(issueReads).toBe(2);
		releasePoll();
		const published = await settledOverviewEvent(events, overviewOf);
		stream.close();
		expect(published.polling).toBeUndefined();
		expect(published.projects[0]?.done).toBe(1);
		expect(published.projects[0]?.backlog).toBe(1);
		expect(published.fetchedAt).not.toBe(before.fetchedAt);
		while (!followUpReachedTracker) {
			await Bun.sleep(20);
		}
		const followUp = await readOverview(base);
		expect(followUp.polling).toBe(true);
		releaseFollowUp();
		const after = await settledOverview(base, readOverview);
		expect(after.fetchedAt).not.toBe(before.fetchedAt);
		expect(after.polling).toBeUndefined();
		expect(
			Date.parse(after.fetchedAt ?? "") - Date.parse(before.fetchedAt ?? ""),
		).toBeGreaterThanOrEqual(pollSpanMs);
	});
}, 20_000);

test("a reply during a held refresh keeps the running poll", async () => {
	const waiting: (() => void)[] = [];
	let released = false;
	let releasePoll: (() => void) | null = null;
	let issueReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const method =
			init?.method ?? (input instanceof Request ? input.method : "GET");
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const comments = url.match(
			/\/repos\/acme\/widget\/issues\/(\d+)\/comments$/,
		);
		if (comments !== null && method === "POST") {
			const posted = JSON.parse(
				typeof init?.body === "string" ? init.body : "{}",
			) as { body?: string };
			return new Response(
				JSON.stringify({
					id: 900,
					body: posted.body ?? "",
					html_url: "https://github.com/acme/widget/issues/1#issuecomment-900",
					created_at: "2026-04-02T00:00:00.000Z",
					user: { login: "lev" },
				}),
				{
					status: 201,
					headers: { "content-type": "application/json" },
				},
			);
		}
		if (listUrl(url) !== null) {
			issueReads += 1;
			if (issueReads > 1) {
				await new Promise<void>((resolve) => {
					if (released) {
						resolve();
						return;
					}
					waiting.push(resolve);
					releasePoll = () => {
						released = true;
						for (const release of waiting.splice(0)) {
							release();
						}
					};
				});
				return page([ticket(1, "2026-04-02T00:00:00Z")]);
			}
			return page([ticket(1, "2026-04-01T00:00:00Z")]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	await withServer(fetchImpl, 3600, async (base) => {
		const stream = openEventStream(base);
		await stream.ready;
		const refresh = await fetch(new URL("/api/refresh", base), {
			method: "POST",
		});
		expect(refresh.status).toBe(204);
		while (releasePoll === null) {
			await Bun.sleep(20);
		}
		const events = stream.events[Symbol.asyncIterator]();
		const started = await events.next();
		expect(started.done).toBe(false);
		if (!started.done && started.value !== undefined) {
			expect(started.value.event).toBe("overview");
			expect((JSON.parse(started.value.data) as OverviewBody).polling).toBe(
				true,
			);
		}
		const reply = await fetch(new URL("/api/replies", base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				tracker: "github",
				project: repo,
				key: `${repo}#1`,
				body: "Use the short name.",
			}),
		});
		expect(reply.status).toBe(201);
		const replied = await events.next();
		expect(replied.done).toBe(false);
		if (!replied.done && replied.value !== undefined) {
			expect(replied.value.event).toBe("overview");
			const body = JSON.parse(replied.value.data) as OverviewBody;
			expect(body.polling).toBe(true);
		}
		const release = releasePoll;
		if (release === null) {
			throw new Error("the refresh poll never reached the tracker");
		}
		release();
		releasePoll = null;
		const published = await settledOverviewEvent(events, overviewOf);
		stream.close();
		expect(published.polling).toBeUndefined();
	});
}, 20_000);

test("a refresh whose tracker fails still answers and ends the running poll", async () => {
	let issueReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			issueReads += 1;
			if (issueReads > 1) {
				return new Response("recorded failure", { status: 500 });
			}
			return page([ticket(1, "2026-04-01T00:00:00Z")]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	await withServer(fetchImpl, 3600, async (base) => {
		const refresh = await fetch(new URL("/api/refresh", base), {
			method: "POST",
			body: "",
		});
		expect(refresh.status).toBe(204);
		const body = await settledOverview(base, readOverview);
		expect(body.polling).toBeUndefined();
		expect(body.projects[0]?.error).toContain("HTTP 500");
	});
});

test("a refresh whose tracker rejects still answers and ends the running poll", async () => {
	let issueReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			issueReads += 1;
			if (issueReads > 1) {
				throw new Error("recorded rejection");
			}
			return page([ticket(1, "2026-04-01T00:00:00Z")]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const crashes: unknown[] = [];
	const onRejection = (reason: unknown) => {
		crashes.push(reason);
	};
	process.on("unhandledRejection", onRejection);
	try {
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
				body: "   ",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
			expect(body.polling).toBeUndefined();
			expect(body.projects[0]?.error).toContain("recorded rejection");
			const again = await fetch(new URL("/api/refresh", base), {
				method: "POST",
				body: "",
			});
			expect(again.status).toBe(204);
			const after = await settledOverview(base, readOverview);
			expect(after.polling).toBeUndefined();
		});
		await Bun.sleep(50);
		expect(crashes).toEqual([]);
	} finally {
		process.off("unhandledRejection", onRejection);
	}
});

test("a refresh joining a poll held on the list gate publishes polling", async () => {
	let releasePoll: () => void = () => {};
	const pollHeld = new Promise<void>((resolve) => {
		releasePoll = resolve;
	});
	let listReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listedRead(input, init)?.repo === repo) {
			await pollHeld;
			listReads += 1;
			return (
				issuesResponse(input, init, [ticket(9, "2026-04-03T00:00:00Z")]) ??
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
	const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	const filler = await run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: async (input, init) => {
				const discovered = recordedDiscovery(input, init);
				if (discovered !== null) {
					return discovered;
				}
				const url = urlOf(input);
				if (url === "https://api.github.com/user") {
					return new Response(JSON.stringify({ login: "lev" }), {
						status: 200,
					});
				}
				if (listedRead(input, init)?.repo === repo) {
					return (
						issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
						page([])
					);
				}
				return recordedOrEmpty(url) ?? unrecorded(input);
			},
			readGhToken: async () => null,
			databasePath,
			now: () => new Date(goodPoll),
			listTodos: async () => "",
			waitForStop: Promise.resolve(),
		}),
	);
	expect(filler.exitCode).toBe(0);
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const before = await readOverview(base);
				expect(before.polling).toBeUndefined();
				expect(before.projects[0]?.done).toBe(0);
				expect(before.projects[0]?.backlog).toBe(1);
				expect(listReads).toBe(0);
				const stream = openEventStream(base);
				await stream.ready;
				const events = stream.events[Symbol.asyncIterator]();
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
					body: "   ",
				});
				expect(refresh.status).toBe(204);
				let published: OverviewBody | null = null;
				while (published === null) {
					const received = await events.next();
					if (received.done) {
						break;
					}
					if (received.value?.event !== "overview") {
						continue;
					}
					const body = overviewOf(received.value.data);
					if (body.polling === true) {
						published = body;
					}
				}
				expect(listReads).toBe(0);
				expect(published?.polling).toBe(true);
				expect(published?.projects[0]?.backlog).toBe(1);
				releasePoll();
				const settled = await settledOverviewEvent(events, overviewOf);
				stream.close();
				expect(settled.polling).toBeUndefined();
				expect(settled.projects[0]?.done).toBe(0);
				expect(settled.projects[0]?.backlog).toBe(2);
				resolve();
			})().catch((error: unknown) => {
				releasePoll();
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			{
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: answerRecordedRepoRead(fetchImpl),
				readGhToken: async () => null,
				databasePath,
				now: () => new Date("2026-04-03T12:00:00.000Z"),
				listTodos: async () => "",
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			},
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releasePoll();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}, 20_000);
