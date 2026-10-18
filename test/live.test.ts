import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, urlOf } from "./support.ts";

const repo = "acme/widget";
const otherRepo = "acme/other";

function ticket(
	number: number,
	updatedAt: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: null,
		updated_at: updatedAt,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function listUrl(url: string, name = repo): URL | null {
	if (!url.startsWith(`https://api.github.com/repos/${name}/issues?`)) {
		return null;
	}
	return new URL(url);
}

function changingFetch(requests: string[]): Fetch {
	let polls = 0;
	return async (input) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const list = listUrl(url);
		if (list !== null) {
			requests.push(url);
			polls += 1;
			if (polls === 1) {
				return page([ticket(1, "2026-04-01T00:00:00Z")]);
			}
			return page([
				ticket(1, "2026-04-02T00:00:00Z", "closed"),
				ticket(2, "2026-04-02T00:00:00Z"),
			]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

type ChangeEvent = {
	event: string;
	data: string;
};

function openEvents(base: string): Promise<ChangeEvent> {
	return new Promise((resolve, reject) => {
		const socket = Bun.connect({
			hostname: "127.0.0.1",
			port: Number(new URL(base).port),
			socket: {
				data(_socket, data) {
					const text = data.toString();
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
					if (event !== undefined && payload !== "") {
						resolve({ event, data: payload });
					}
				},
				error(_socket, error) {
					reject(error);
				},
				open(socket) {
					socket.write(
						"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
					);
				},
			},
		});
		setTimeout(() => {
			void socket.then((open) => open.end());
			reject(new Error("no event within 3000ms"));
		}, 3_000);
	});
}

function failingAfterGoodPoll(requests: string[]): Fetch {
	let polls = 0;
	return async (input) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			requests.push(url);
			polls += 1;
			if (polls === 1) {
				return page([ticket(1, "2026-04-01T00:00:00Z")]);
			}
			return new Response("recorded failure", { status: 500 });
		}
		return new Response("not recorded", { status: 404 });
	};
}

function unchangedFetch(requests: string[]): Fetch {
	return async (input) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			requests.push(url);
			return page([]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

function failingThenRecorded(requests: string[]): Fetch {
	let polls = 0;
	return async (input) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			requests.push(url);
			polls += 1;
			if (polls === 2) {
				return new Response("recorded failure", { status: 500 });
			}
			return page([ticket(1, "2026-04-01T00:00:00Z")]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

const goodPoll = "2026-04-01T12:00:00.000Z";

type OverviewBody = {
	projects: {
		name: string;
		tracker: string;
		done: number;
		dropped: number;
		backlog: number;
	}[];
	fetchedAt: string | null;
	error: string | null;
};

async function withServer(
	fetchImpl: Fetch,
	intervalSeconds: number,
	checks: (base: string) => Promise<void>,
	pinned: { tracker: "github"; repo: string }[] = [{ tracker: "github", repo }],
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned, pollIntervalSeconds: intervalSeconds }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	let checksError: unknown;
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			checks(base).then(resolve, (error: unknown) => {
				checksError = error;
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	let ticks = 0;
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			{
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date(Date.parse(goodPoll) + ticks++ * 1_000),
				stdout: (line) => startChecks(line),
				waitForStop: done,
			},
		);
		if (checksError !== undefined) {
			throw checksError;
		}
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("live updates", () => {
	test("a zero poll interval names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 0,
			}),
		);
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: unchangedFetch([]),
				readGhToken: async () => null,
				databasePath: ":memory:",
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pollIntervalSeconds");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("a blank poll interval names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: "   ",
			}),
		);
		try {
			const result = await run(["--config", path], {
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: unchangedFetch([]),
				readGhToken: async () => null,
				databasePath: ":memory:",
				waitForStop: Promise.resolve(),
			});
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("pollIntervalSeconds");
			expect(result.listened).toBe(false);
		} finally {
			await cleanup();
		}
	});

	test("an empty incremental page keeps the stored tickets", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (listUrl(url) !== null) {
				requests.push(url);
				polls += 1;
				return page(polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : []);
			}
			return new Response("not recorded", { status: 404 });
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			expect(body.projects).toEqual([
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
				},
			]);
			expect(body.error).toBeNull();
			const second = new URL(requests[1] ?? "");
			expect(second.searchParams.get("since")).toBe(goodPoll);
		});
	});

	test("a failed fetch keeps the stored overview and names the error", async () => {
		const requests: string[] = [];
		await withServer(failingAfterGoodPoll(requests), 3600, async (base) => {
			const eventPromise = openEvents(base);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			expect(body.projects).toEqual([
				{
					name: repo,
					tracker: "github",
					done: 0,
					dropped: 0,
					backlog: 1,
				},
			]);
			expect(body.fetchedAt).toBe(goodPoll);
			expect(body.error).toContain("HTTP 500");
			expect(body.error).toContain(`stale since ${goodPoll}`);
			const received = await eventPromise;
			expect(JSON.parse(received.data)).toEqual(body);
		});
	});

	test("a later pin failure keeps the earlier pin's tickets and since", async () => {
		const requests: string[] = [];
		const failedPins = new Set<string>();
		const fetchImpl: Fetch = async (input) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const first = listUrl(url, repo);
			const second = listUrl(url, otherRepo);
			if (first !== null || second !== null) {
				requests.push(url);
				if (url.includes(otherRepo) && !failedPins.has(url)) {
					failedPins.add(url);
					return new Response("recorded failure", { status: 500 });
				}
				return page([ticket(1, "2026-04-01T00:00:00Z")]);
			}
			return new Response("not recorded", { status: 404 });
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const failed = await fetch(new URL("/api/overview", base));
				const failedEvent = (await failed.json()) as OverviewBody;
				expect(failedEvent.projects).toEqual([
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
					},
				]);
				expect(failedEvent.error).toContain("HTTP 500");
				expect(failedEvent.error).toContain(otherRepo);
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const firstLists = requests.filter(
					(url) => listUrl(url, repo) !== null,
				);
				const secondLists = requests.filter(
					(url) => listUrl(url, otherRepo) !== null,
				);
				expect(firstLists).toHaveLength(2);
				expect(secondLists).toHaveLength(2);
				expect(
					new URL(firstLists[0] ?? "").searchParams.get("since"),
				).toBeNull();
				expect(new URL(firstLists[1] ?? "").searchParams.get("since")).toBe(
					goodPoll,
				);
				expect(
					new URL(secondLists[0] ?? "").searchParams.get("since"),
				).toBeNull();
				expect(
					new URL(secondLists[1] ?? "").searchParams.get("since"),
				).toBeNull();
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects).toEqual([
					...failedEvent.projects,
					{
						name: otherRepo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
					},
				]);
				expect(body.error).toBeNull();
				expect(body.fetchedAt).toBe("2026-04-01T12:00:01.000Z");
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a poll after a failed fetch keeps the last good since", async () => {
		const requests: string[] = [];
		await withServer(failingThenRecorded(requests), 3600, async (base) => {
			const failed = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(failed.status).toBe(204);
			const again = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(again.status).toBe(204);
			const lists = requests.filter((url) => listUrl(url) !== null);
			expect(lists).toHaveLength(3);
			expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(goodPoll);
			expect(new URL(lists[2] ?? "").searchParams.get("since")).toBe(goodPoll);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			expect(body.fetchedAt).toBe("2026-04-01T12:00:02.000Z");
			expect(body.error).toBeNull();
		});
	});

	test("a poll at the interval requests items updated since the last good poll", async () => {
		const requests: string[] = [];
		await withServer(unchangedFetch(requests), 1, async () => {
			const deadline = Date.now() + 3_000;
			while (
				requests.filter((url) => listUrl(url) !== null).length < 2 &&
				Date.now() < deadline
			) {
				await Bun.sleep(50);
			}
			const lists = requests.filter((url) => listUrl(url) !== null);
			expect(lists).toHaveLength(2);
			expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(goodPoll);
		});
	});

	test("an incremental poll requests only items updated since the last good poll", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const lists = requests.filter((url) => listUrl(url) !== null);
			expect(lists).toHaveLength(2);
			expect(new URL(lists[0] ?? "").searchParams.get("since")).toBeNull();
			expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(goodPoll);
		});
	});

	test("a recorded tracker change reaches a subscriber after one poll", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const eventPromise = openEvents(base);
			const before = await fetch(new URL("/api/overview", base));
			expect(await before.json()).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 0,
						dropped: 0,
						backlog: 1,
					},
				],
				fetchedAt: goodPoll,
				error: null,
			});
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const received = await eventPromise;
			expect(received.event).toBe("overview");
			expect(JSON.parse(received.data)).toEqual({
				projects: [
					{
						name: repo,
						tracker: "github",
						done: 1,
						dropped: 0,
						backlog: 1,
					},
				],
				fetchedAt: "2026-04-01T12:00:01.000Z",
				error: null,
			});
			const after = await fetch(new URL("/api/overview", base));
			expect(await after.json()).toEqual(JSON.parse(received.data));
		});
	});

	test("the event stream stays open past the idle timeout", async () => {
		const requests: string[] = [];
		await withServer(unchangedFetch(requests), 3600, async (base) => {
			const port = Number(new URL(base).port);
			const started = Date.now();
			let closed = false;
			const socket = await Bun.connect({
				hostname: "127.0.0.1",
				port,
				socket: {
					data() {},
					close() {
						closed = true;
					},
					open(open) {
						open.write(
							"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
						);
					},
				},
			});
			await Bun.sleep(11_000);
			expect(closed).toBe(false);
			expect(Date.now() - started).toBeGreaterThan(10_000);
			const probe = await fetch(new URL("/api/overview", base));
			expect(probe.status).toBe(200);
			socket.end();
		});
	}, 15_000);

	test("a broken configuration on refresh keeps the last overview", async () => {
		const requests: string[] = [];
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
					const { writeFile } = await import("node:fs/promises");
					await writeFile(path, "{");
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const body = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as OverviewBody;
					expect(body.projects).toEqual([
						{
							name: repo,
							tracker: "github",
							done: 0,
							dropped: 0,
							backlog: 0,
						},
					]);
					expect(body.error).toContain("not JSON");
					resolve();
				})().catch(reject);
			};
		});
		let ticks = 0;
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch(requests),
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(Date.parse(goodPoll) + ticks++ * 1_000),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
