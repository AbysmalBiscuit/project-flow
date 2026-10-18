import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, urlOf } from "./support.ts";

const repo = "acme/widget";

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

function listUrl(url: string): URL | null {
	if (!url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
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
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const body = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as {
						projects: {
							name: string;
							tracker: string;
							done: number;
							dropped: number;
							backlog: number;
						}[];
						error: string | null;
					};
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
					expect(second.searchParams.get("since")).toBe(
						"2026-04-01T12:00:00.000Z",
					);
					resolve();
				})().catch(reject);
			};
		});
		let polls = 0;
		let ticks = 0;
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
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a failed fetch keeps the stored overview and names the error", async () => {
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
					const eventPromise = openEvents(base);
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const body = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as {
						projects: {
							name: string;
							tracker: string;
							done: number;
							dropped: number;
							backlog: number;
						}[];
						fetchedAt: string;
						error: string;
					};
					expect(body.projects).toEqual([
						{
							name: repo,
							tracker: "github",
							done: 0,
							dropped: 0,
							backlog: 1,
						},
					]);
					expect(body.fetchedAt).toBe("2026-04-01T12:00:00.000Z");
					expect(body.error).toContain("HTTP 500");
					expect(body.error).toContain("stale since 2026-04-01T12:00:00.000Z");
					const received = await eventPromise;
					expect(JSON.parse(received.data)).toEqual(body);
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
					fetch: failingAfterGoodPoll(requests),
					readGhToken: async () => null,
					databasePath,
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
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

	test("a poll at the interval requests items updated since the last good poll", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 1,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = () => {
				void (async () => {
					const deadline = Date.now() + 3_000;
					while (
						requests.filter((url) => listUrl(url) !== null).length < 2 &&
						Date.now() < deadline
					) {
						await Bun.sleep(50);
					}
					const lists = requests.filter((url) => listUrl(url) !== null);
					expect(lists).toHaveLength(2);
					expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(
						"2026-04-01T12:00:00.000Z",
					);
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
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an incremental poll requests only items updated since the last good poll", async () => {
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
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const lists = requests.filter((url) => listUrl(url) !== null);
					expect(lists).toHaveLength(2);
					expect(new URL(lists[0] ?? "").searchParams.get("since")).toBeNull();
					expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(
						"2026-04-01T12:00:00.000Z",
					);
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
					fetch: changingFetch(requests),
					readGhToken: async () => null,
					databasePath,
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
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

	test("a recorded tracker change reaches a subscriber after one poll", async () => {
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
						fetchedAt: "2026-04-01T12:00:00.000Z",
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
					fetch: changingFetch(requests),
					readGhToken: async () => null,
					databasePath,
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
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
