import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, tempConfig, testIo, urlOf } from "./support.ts";

const repo = "acme/widget";
const otherRepo = "acme/other";
const linearProject = "widget-launch";

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

function recordedOrEmpty(url: string): Response | null {
	if (url.includes("/pulls?") || url.includes("/branches?")) {
		return page([]);
	}
	return null;
}

function listUrl(url: string, name = repo): URL | null {
	if (!url.startsWith(`https://api.github.com/repos/${name}/issues?`)) {
		return null;
	}
	return new URL(url);
}

function changingFetch(requests: string[]): Fetch {
	let polls = 0;
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
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
		return (
			recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
		);
	};
}

type ChangeEvent = {
	event: string;
	data: string;
};

function openEvents(base: string): Promise<ChangeEvent> {
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
						if (event !== undefined && payload !== "") {
							resolve({ event, data: payload });
						}
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
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
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
		return (
			recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
		);
	};
}

function unchangedFetch(requests: string[]): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (listUrl(url) !== null) {
			requests.push(url);
			return page([]);
		}
		return (
			recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
		);
	};
}

function failingThenRecorded(requests: string[]): Fetch {
	let polls = 0;
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
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
		return (
			recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
		);
	};
}

const goodPoll = "2026-04-01T12:00:00.000Z";

type OverviewBody = {
	projects: {
		name: string;
		tracker: string;
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		unlinkedPrs: unknown[];
		tickets: {
			key: string | null;
			title: string;
			state: string;
			blockers: string[];
		}[];
		crossProjectBlockers: unknown[];
		needsYou: number;
		progress: number;
		fetchedAt: string | null;
		error: string | null;
	}[];
	fetchedAt: string | null;
	error: string | null;
};

function counts(
	name: string,
	backlog: number,
	done = 0,
	tracker: "github" | "linear" = "github",
	tickets: OverviewBody["projects"][number]["tickets"] = [],
	fetchedAt: string | null = goodPoll,
	error: string | null = null,
): OverviewBody["projects"][number] {
	return {
		name,
		tracker,
		done,
		dropped: 0,
		blocked: 0,
		backlog,
		inProgress: 0,
		unlinkedPrs: [],
		tickets,
		crossProjectBlockers: [],
		needsYou: 0,
		progress: backlog + done === 0 ? 0 : Math.round((done / (backlog + done)) * 100),
		fetchedAt,
		error,
	};
}

function githubTicket(
	number: number,
	state: "backlog" | "done",
): OverviewBody["projects"][number]["tickets"][number] {
	return {
		key: `${repo}#${number}`,
		title: `Ticket ${number}`,
		state,
		blockers: [],
	};
}

function linearTicket(
	number: number,
): OverviewBody["projects"][number]["tickets"][number] {
	return {
		key: `WID-${number}`,
		title: "",
		state: "backlog",
		blockers: [],
	};
}

function linearIssue(id: string): Record<string, unknown> {
	return {
		identifier: `WID-${id}`,
		updatedAt: "2026-04-01T00:00:00.000Z",
		state: { type: "backlog" },
		attachments: { nodes: [] },
	};
}

function linearPage(nodes: Record<string, unknown>[]): string {
	return JSON.stringify({
		data: {
			issues: {
				nodes,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

type IssueFilter = {
	project?: { id?: { eq?: string } };
	updatedAt?: { gte?: string };
};

function linearIssueFilter(body: string): IssueFilter | null {
	const parsed = JSON.parse(body) as {
		query?: string;
		variables?: { filter?: IssueFilter; since?: string | null };
	};
	if (!parsed.query?.includes("ProjectIssues")) {
		return null;
	}
	return parsed.variables?.filter ?? null;
}

function linearListSince(body: string): string | null {
	return linearIssueFilter(body)?.updatedAt?.gte ?? null;
}

function linearPinFetch(requests: string[]): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		if (url === "https://api.linear.app/graphql") {
			const body =
				typeof init?.body === "string" ? init.body : JSON.stringify(init?.body);
			const parsed = JSON.parse(body) as { query?: string };
			if (parsed.query?.includes("viewer")) {
				return new Response(
					JSON.stringify({ data: { viewer: { id: "lev" } } }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (parsed.query?.includes("ProjectByPin")) {
				return new Response(
					JSON.stringify({
						data: {
							projects: {
								nodes: [
									{
										id: "project-1",
										name: linearProject,
										slugId: linearProject,
									},
								],
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}
			const filter = linearIssueFilter(body);
			if (filter !== null) {
				requests.push(body);
			}
			if (filter !== null && requests.length === 2) {
				return new Response("recorded failure", { status: 500 });
			}
			return new Response(linearPage([linearIssue("1")]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function withServer(
	fetchImpl: Fetch,
	intervalSeconds: number,
	checks: (base: string, advance: (ms: number) => void) => Promise<void>,
	pinned: (
		| { tracker: "github"; repo: string }
		| { tracker: "linear"; project: string }
	)[] = [{ tracker: "github", repo }],
	env: Record<string, string | undefined> = {
		GITHUB_TOKEN: "recorded-token",
	},
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned, pollIntervalSeconds: intervalSeconds }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string, advance: (ms: number) => void) => void =
		() => {};
	let checksError: unknown;
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base: string, advance: (ms: number) => void) => {
			checks(base, advance).then(resolve, (error: unknown) => {
				checksError = error;
				reject(error instanceof Error ? error : new Error("checks failed"));
			});
		};
	});
	let ticks = 0;
	let advanced = 0;
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				now: () => new Date(Date.parse(goodPoll) + advanced + ticks++ * 1_000),
				stdout: (line) =>
					startChecks(line, (ms) => {
						advanced += ms;
					}),
				waitForStop: done,
			}),
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

function seedSnapshot(databasePath: string): void {
	const db = new Database(databasePath);
	db.run(`
		create table snapshots (
			snapshot_key text primary key,
			name text not null,
			tracker text not null,
			payload text not null
		)
	`);
	db.run(`
		create table fetch_status (
			id integer primary key check (id = 1),
			fetched_at text,
			error text
		)
	`);
	db.run("insert into fetch_status (id, fetched_at) values (1, ?)", [goodPoll]);
	db.run(`
		create table project_polls (
			project text primary key,
			fetched_at text not null
		)
	`);
	db.run("insert into project_polls (project, fetched_at) values (?, ?)", [
		repo,
		goodPoll,
	]);
	db.run(
		"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
		[
			`github:${repo}`,
			repo,
			"github",
			JSON.stringify({
				tickets: [
					{
						id: "1",
						tracker: "github",
						key: `${repo}#1`,
						title: "Ticket 1",
						state: "open",
						stateReason: null,
						updatedAt: "2026-04-01T00:00:00Z",
						body: "",
						blockedBy: [],
					},
				],
				pulls: [],
				branches: [],
				startedKeys: [],
			}),
		],
	);
	db.close();
}

describe("live updates", () => {
	test("stored rows are served before the first poll ends", async () => {
		const requests: string[] = [];
		let releasePoll: () => void = () => {};
		const pollHeld = new Promise<void>((resolve) => {
			releasePoll = resolve;
		});
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
				requests.push(url);
				await pollHeld;
				return page([ticket(9, "2026-04-03T00:00:00Z")]);
			}
			return (
				recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
			);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		seedSnapshot(databasePath);
		let startChecks: (base: string) => void = () => {};
		let listened = false;
		const checks = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!listened) {
					reject(
						new Error("server did not listen before the first poll ended"),
					);
				}
			}, 1_000);
			startChecks = (base: string) => {
				listened = true;
				clearTimeout(timer);
				void (async () => {
					const body = (await (
						await fetch(new URL("/api/overview", base))
					).json()) as OverviewBody;
					expect(requests.filter((url) => listUrl(url) !== null)).toEqual([]);
					expect(body.projects).toEqual([
						counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
					]);
					expect(body.fetchedAt).toBe(goodPoll);
					expect(body.error).toBeNull();
					releasePoll();
					const deadline = Date.now() + 3_000;
					while (
						requests.filter((url) => listUrl(url) !== null).length < 1 &&
						Date.now() < deadline
					) {
						await Bun.sleep(20);
					}
					expect(requests.filter((url) => listUrl(url) !== null)).toHaveLength(
						1,
					);
					resolve();
				})().catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
			);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
		} finally {
			releasePoll();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a zero poll interval names the field and does not listen", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pollIntervalSeconds: 0,
			}),
		);
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch([]),
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
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
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch([]),
					readGhToken: async () => null,
					databasePath: ":memory:",
					waitForStop: Promise.resolve(),
				}),
			);
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
				requests.push(url);
				polls += 1;
				return page(polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : []);
			}
			return (
				recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
			);
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
				counts(
					repo,
					1,
					0,
					"github",
					[githubTicket(1, "backlog")],
					"2026-04-01T12:00:01.000Z",
				),
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
				counts(
					repo,
					1,
					0,
					"github",
					[githubTicket(1, "backlog")],
					goodPoll,
					body.projects[0]?.error ?? null,
				),
			]);
			expect(body.projects[0]?.error).toContain("HTTP 500");
			expect(body.projects[0]?.error).toContain(`stale since ${goodPoll}`);
			expect(body.fetchedAt).toBe(goodPoll);
			expect(body.error).toBeNull();
			const received = await eventPromise;
			expect(JSON.parse(received.data)).toEqual(body);
		});
	});

	test("a failed fetch marks only its own project stale", async () => {
		const requests: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const first = listUrl(url, repo);
			const second = listUrl(url, otherRepo);
			if (first !== null || second !== null) {
				requests.push(url);
				if (url.includes(otherRepo)) {
					return new Response("   ", { status: 500 });
				}
				return page([ticket(1, "2026-04-01T00:00:00Z")]);
			}
			return (
				recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
			);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const fresh = body.projects.find((project) => project.name === repo);
				const stale = body.projects.find(
					(project) => project.name === otherRepo,
				);
				expect(fresh?.tickets).toEqual([githubTicket(1, "backlog")]);
				expect(fresh?.error).toBeNull();
				expect(stale?.error).toContain("HTTP 500");
				expect(stale?.error).toContain(otherRepo);
				expect(stale?.error).not.toContain("stale since");
				expect(body.error).toBeNull();
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const repeated = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const stillFresh = repeated.projects.find(
					(project) => project.name === repo,
				);
				const stillStale = repeated.projects.find(
					(project) => project.name === otherRepo,
				);
				expect(stillFresh?.error).toBeNull();
				expect(stillStale?.error).toContain("HTTP 500");
				expect(stillStale?.error).not.toContain(repo);
				expect(repeated.error).toBeNull();
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a later pin failure keeps the earlier pin's tickets and since", async () => {
		const requests: string[] = [];
		const failedPins = new Set<string>();
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
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
			return (
				recordedOrEmpty(url) ?? new Response("not recorded", { status: 404 })
			);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const failed = await fetch(new URL("/api/overview", base));
				const failedEvent = (await failed.json()) as OverviewBody;
				expect(failedEvent.projects).toEqual([
					counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
					counts(
						otherRepo,
						0,
						0,
						"github",
						[],
						null,
						failedEvent.projects[1]?.error ?? null,
					),
				]);
				expect(failedEvent.projects[1]?.error).toContain("HTTP 500");
				expect(failedEvent.projects[1]?.error).toContain(otherRepo);
				expect(failedEvent.error).toBeNull();
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
					counts(
						repo,
						1,
						0,
						"github",
						[githubTicket(1, "backlog")],
						"2026-04-01T12:00:01.000Z",
					),
					counts(
						otherRepo,
						1,
						0,
						"github",
						[
							{
								key: `${otherRepo}#1`,
								title: "Ticket 1",
								state: "backlog",
								blockers: [],
							},
						],
						"2026-04-01T12:00:01.000Z",
					),
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

	test("a ticket that left a Linear project leaves its card after the next full poll", async () => {
		const requests: string[] = [];
		let polls = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				const body =
					typeof init?.body === "string"
						? init.body
						: JSON.stringify(init?.body);
				const parsed = JSON.parse(body) as { query?: string };
				if (parsed.query?.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (parsed.query?.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: linearProject,
											slugId: linearProject,
										},
									],
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				requests.push(body);
				polls += 1;
				const nodes =
					polls === 1
						? [linearIssue("1"), linearIssue("2")]
						: [linearIssue("2")];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response("not recorded", { status: 404 });
		};
		await withServer(
			fetchImpl,
			1,
			async (base) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(first.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
					"WID-2",
				]);
				const deadline = Date.now() + 3_000;
				while (requests.length < 3 && Date.now() < deadline) {
					await Bun.sleep(50);
				}
				expect(requests).toHaveLength(3);
				expect(requests.map(linearListSince)).toEqual([null, goodPoll, null]);
				const filters = requests
					.map(linearIssueFilter)
					.filter((filter) => filter !== null);
				expect(filters[2]?.updatedAt).toBeUndefined();
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-2",
				]);
				expect(body.error).toBeNull();
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a full Linear poll omits updatedAt and a later poll filters on it", async () => {
		const requests: string[] = [];
		await withServer(
			linearPinFetch(requests),
			3600,
			async (base) => {
				const first = await fetch(new URL("/api/overview", base));
				const firstBody = (await first.json()) as OverviewBody;
				expect(firstBody.projects).toEqual([
					counts(linearProject, 1, 0, "linear", [linearTicket(1)]),
				]);
				expect(firstBody.error).toBeNull();
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const filters = requests
					.map(linearIssueFilter)
					.filter((filter) => filter !== null);
				expect(filters[0]).toEqual({
					project: { id: { eq: "project-1" } },
				});
				expect(filters[0]?.updatedAt).toBeUndefined();
				expect(filters[1]).toEqual({
					project: { id: { eq: "project-1" } },
					updatedAt: { gte: goodPoll },
				});
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a failed Linear incremental poll is requested again with the same since", async () => {
		const requests: string[] = [];
		await withServer(
			linearPinFetch(requests),
			3600,
			async (base) => {
				const failed = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(failed.status).toBe(204);
				const failedBody = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(failedBody.projects).toEqual([
					counts(
						linearProject,
						1,
						0,
						"linear",
						[linearTicket(1)],
						goodPoll,
						failedBody.projects[0]?.error ?? null,
					),
				]);
				expect(failedBody.projects[0]?.error).toContain("HTTP 500");
				expect(failedBody.error).toBeNull();
				expect(failedBody.fetchedAt).toBe(goodPoll);
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				const lists = requests.map(linearListSince);
				expect(lists).toEqual([null, goodPoll, goodPoll]);
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects).toEqual([
					counts(
						linearProject,
						1,
						0,
						"linear",
						[linearTicket(1)],
						"2026-04-01T12:00:02.000Z",
					),
				]);
				expect(body.error).toBeNull();
				expect(body.fetchedAt).toBe("2026-04-01T12:00:02.000Z");
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
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
			const beforeBody = (await before.json()) as OverviewBody;
			expect(beforeBody.projects).toEqual([
				counts(repo, 1, 0, "github", [githubTicket(1, "backlog")]),
			]);
			expect(beforeBody.fetchedAt).toBe(goodPoll);
			expect(beforeBody.error).toBeNull();
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const received = await eventPromise;
			expect(received.event).toBe("overview");
			const eventBody = JSON.parse(received.data) as OverviewBody;
			expect(eventBody.projects).toEqual([
				counts(
					repo,
					1,
					1,
					"github",
					[githubTicket(1, "done"), githubTicket(2, "backlog")],
					"2026-04-01T12:00:01.000Z",
				),
			]);
			expect(eventBody.fetchedAt).toBe("2026-04-01T12:00:01.000Z");
			expect(eventBody.error).toBeNull();
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
					expect(body.error).toContain("not JSON");
					expect(body.projects).toEqual([
						counts(repo, 0, 0, "github", [], goodPoll),
					]);
					resolve();
				})().catch(reject);
			};
		});
		let ticks = 0;
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: unchangedFetch(requests),
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(Date.parse(goodPoll) + ticks++ * 1_000),
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
});
