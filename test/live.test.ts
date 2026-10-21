import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedProgressComment from "./fixtures/github-progress-comment.json";
import {
	githubIssueNode,
	recordedDiscovery,
	repoReadIssues,
	settledOverview,
	settledOverviewEvent,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";
const otherRepo = "acme/other";
const thirdRepo = "acme/third";
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
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	return null;
}

type ListedRead = {
	url: string;
	since: string | null;
	repo: string;
	poll: string;
};

function listedRead(
	input: string | URL | Request,
	init?: RequestInit,
): ListedRead | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string; since?: string | null };
	};
	const owner = parsed.variables?.owner ?? "";
	const name = parsed.variables?.name ?? "";
	const since = parsed.variables?.since ?? null;
	const omitted = since === null || since === "";
	return {
		url: omitted
			? `https://api.github.com/repos/${owner}/${name}/issues`
			: `https://api.github.com/repos/${owner}/${name}/issues?since=${since}`,
		since: omitted ? null : String(since),
		repo: `${owner}/${name}`,
		poll: `${owner}/${name}\0${since ?? ""}`,
	};
}

function listUrl(url: string, name = repo): URL | null {
	const parsed = new URL(url);
	if (parsed.origin !== "https://api.github.com") {
		return null;
	}
	if (parsed.pathname !== `/repos/${name}/issues`) {
		return null;
	}
	return parsed;
}

function issuesResponse(
	input: string | URL | Request,
	init: RequestInit | undefined,
	issues: Record<string, unknown>[],
	name = repo,
): Response | null {
	const listed = listedRead(input, init);
	if (listed === null || listed.repo !== name) {
		return null;
	}
	const since = listed.since ?? "";
	const sinceDay = since.slice(0, 10);
	const nodes = issues
		.filter((item) => {
			const updated = String(item.updated_at ?? item.updatedAt ?? "");
			return (
				since === "" || updated >= since || updated.slice(0, 10) >= sinceDay
			);
		})
		.map((item) => githubIssueNode(item));
	return new Response(
		JSON.stringify(
			repoReadIssues(
				listed.repo.split("/")[0] ?? "acme",
				listed.repo.split("/")[1] ?? "widget",
				nodes,
			),
		),
		{
			status: 200,
			headers: {
				"content-type": "application/json",
				"x-listed-url": listed.url,
			},
		},
	);
}

const seenPolls = new WeakMap<string[], Set<string>>();

function pushListed(requests: string[], read: ListedRead): void {
	const seen = seenPolls.get(requests) ?? new Set<string>();
	seenPolls.set(requests, seen);
	if (seen.has(read.poll)) {
		return;
	}
	seen.add(read.poll);
	requests.push(read.url);
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
		const listed = listedRead(input, init);
		if (listed !== null && listed.repo === repo) {
			pushListed(requests, listed);
			polls += 1;
			return (
				issuesResponse(
					input,
					init,
					polls === 1
						? [ticket(1, "2026-04-01T00:00:00Z")]
						: [
								ticket(1, "2026-04-02T00:00:00Z", "closed"),
								ticket(2, "2026-04-02T00:00:00Z"),
							],
				) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

type ChangeEvent = {
	event: string;
	data: string;
};

function overviewOf(data: string): OverviewBody {
	return JSON.parse(data) as OverviewBody;
}

async function readOverview(base: string): Promise<OverviewBody> {
	return (await (
		await fetch(new URL("/api/overview", base))
	).json()) as OverviewBody;
}

function readSseEvents(buffer: string): {
	events: ChangeEvent[];
	rest: string;
} {
	const blocks = buffer.split("\n\n");
	const rest = blocks.pop() ?? "";
	const events: ChangeEvent[] = [];
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
			events.push({ event, data: payload });
		}
	}
	return { events, rest };
}

function openEventStream(base: string): {
	events: AsyncIterable<ChangeEvent>;
	close: () => void;
	ready: Promise<void>;
} {
	const queue: ChangeEvent[] = [];
	let wake: (() => void) | null = null;
	let closed = false;
	let buffer = "";
	let markReady = () => {};
	const ready = new Promise<void>((resolve) => {
		markReady = resolve;
	});
	const socket = Bun.connect({
		hostname: "127.0.0.1",
		port: Number(new URL(base).port),
		socket: {
			data(_socket, data) {
				markReady();
				buffer += data.toString();
				const parsed = readSseEvents(buffer);
				buffer = parsed.rest;
				for (const event of parsed.events) {
					queue.push(event);
					wake?.();
				}
			},
			error(_socket, error) {
				queue.push({ event: "error", data: error.message });
				closed = true;
				wake?.();
			},
			open(socket) {
				socket.write(
					"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n",
				);
			},
		},
	});
	return {
		events: {
			async *[Symbol.asyncIterator]() {
				while (!closed) {
					const next = queue.shift();
					if (next !== undefined) {
						yield next;
						continue;
					}
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
			},
		},
		close: () => {
			closed = true;
			wake?.();
			void socket.then((open) => open.end());
		},
		ready,
	};
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
		const failed = listedRead(input, init);
		if (failed !== null && failed.repo === repo) {
			requests.push(failed.url);
			polls += 1;
			if (polls === 1) {
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return new Response("recorded failure", { status: 500 });
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
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
		const steady = listedRead(input, init);
		if (steady !== null && steady.repo === repo) {
			pushListed(requests, steady);
			return issuesResponse(input, init, []) ?? page([]);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
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
		const recovered = listedRead(input, init);
		if (recovered !== null && recovered.repo === repo) {
			pushListed(requests, recovered);
			polls += 1;
			if (polls === 2) {
				return new Response("recorded failure", { status: 500 });
			}
			return (
				issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
				page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
}

const goodPoll = "2026-04-01T12:00:00.000Z";

type ShownTicket = {
	key: string | null;
	title: string;
	state: string;
	blockers: string[];
	lane?: string;
	statusType?: string;
	chips?: string[];
	run?: { status: string; stage?: string };
	enteredStateAt?: string;
	updatedAt?: string;
};

type OverviewBody = {
	projects: {
		name: string;
		tracker: string;
		done: number;
		dropped: number;
		blocked: number;
		backlog: number;
		inProgress: number;
		inReview: number;
		awaitingMerge: number;
		tags: string[];
		unlinkedPrs: unknown[];
		tickets: ShownTicket[];
		crossProjectBlockers: unknown[];
		needsYou: number;
		progress: number;
		fetchedAt: string | null;
		error: string | null;
		statusTypes: Record<string, number>;
		ref:
			| { tracker: "github"; repo: string }
			| { tracker: "linear"; project: string };
	}[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
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
		inReview: 0,
		awaitingMerge: 0,
		tags: [],
		unlinkedPrs: [],
		tickets,
		crossProjectBlockers: [],
		needsYou: 0,
		progress:
			backlog + done === 0 ? 0 : Math.round((done / (backlog + done)) * 100),
		fetchedAt,
		error,
		statusTypes: {
			backlog,
			inProgress: 0,
			inReview: 0,
			awaitingMerge: 0,
			done,
			dropped: 0,
		},
		ref:
			tracker === "linear"
				? { tracker: "linear", project: name }
				: { tracker: "github", repo: name },
	};
}

function githubTicket(
	number: number,
	state: "backlog" | "done",
	enteredStateAt = "2026-04-01T00:00:00Z",
	updatedAt = "2026-04-01T00:00:00Z",
): OverviewBody["projects"][number]["tickets"][number] {
	return {
		key: `${repo}#${number}`,
		title: `Ticket ${number}`,
		state,
		blockers: [],
		lane: state === "done" ? "Done" : "Backlog",
		statusType: state,
		enteredStateAt,
		updatedAt,
	};
}

function linearTicket(number: number): ShownTicket {
	return {
		key: `WID-${number}`,
		title: "",
		state: "backlog",
		blockers: [],
		lane: "Backlog",
		statusType: "backlog",
		enteredStateAt: "2026-04-01T00:00:00.000Z",
		updatedAt: "2026-04-01T00:00:00.000Z",
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
	or?: {
		updatedAt?: { gte?: string };
		comments?: { updatedAt?: { gte?: string } };
	}[];
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
	const filter = linearIssueFilter(body);
	return (
		filter?.updatedAt?.gte ??
		filter?.or?.find((branch) => branch.updatedAt?.gte !== undefined)?.updatedAt
			?.gte ??
		null
	);
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
		return unrecorded(input);
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
	clockOffsetMs = 0,
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
	let advanced = clockOffsetMs;
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

describe("live updates", () => {
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
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("server did not listen before the first poll ended"));
			}, 1_000);
			startChecks = (base: string) => {
				clearTimeout(timer);
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
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					await Bun.sleep(12_000);
					const started = Date.now();
					const response = await fetch(new URL("/api/overview", base));
					expect(response.status).toBe(200);
					expect(Date.now() - started).toBeLessThan(2_000);
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

	test("a refresh during a poll longer than 10 seconds answers before that poll ends", async () => {
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
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
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
					return page([
						ticket(1, "2026-04-02T00:00:00Z", "closed"),
						ticket(2, "2026-04-02T00:00:00Z"),
					]);
				}
				return page([ticket(1, "2026-04-01T00:00:00Z")]);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const before = await readOverview(base);
			expect(before.polling).toBeUndefined();
			expect(before.fetchedAt).toBe(goodPoll);
			const stream = openEventStream(base);
			await stream.ready;
			const started = Date.now();
			const refresh = fetch(new URL("/api/refresh", base), { method: "POST" });
			const answered = await Promise.race([
				refresh.then((response) => response.status),
				Bun.sleep(2_000).then(() => "still waiting" as const),
			]);
			expect(answered).toBe(204);
			expect(Date.now() - started).toBeLessThan(2_000);
			expect(releasePoll).not.toBeNull();
			const joined = await fetch(new URL("/api/refresh", base), {
				method: "POST",
				body: "   ",
			});
			expect(joined.status).toBe(204);
			expect(issueReads).toBe(2);
			expect(releasePoll).not.toBeNull();
			const running = await readOverview(base);
			expect(running.polling).toBe(true);
			expect(running.fetchedAt).toBe(before.fetchedAt);
			const release = releasePoll;
			if (release === null) {
				throw new Error("the refresh poll never reached the tracker");
			}
			const events = stream.events[Symbol.asyncIterator]();
			const runningEvent = await events.next();
			expect(runningEvent.done).toBe(false);
			if (!runningEvent.done && runningEvent.value !== undefined) {
				const startedPoll = overviewOf(runningEvent.value.data);
				expect(startedPoll.polling).toBe(true);
			}
			await Bun.sleep(11_000);
			expect(issueReads).toBe(2);
			expect(Date.now() - started).toBeGreaterThan(10_000);
			release();
			releasePoll = null;
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			expect(published.polling).toBeUndefined();
			expect(published.projects[0]?.done).toBe(1);
			expect(published.projects[0]?.backlog).toBe(1);
			expect(published.fetchedAt).not.toBe(before.fetchedAt);
			const after = await settledOverview(base, readOverview);
			expect(after.fetchedAt).not.toBe(before.fetchedAt);
			expect(after.polling).toBeUndefined();
		});
	}, 30_000);

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
						html_url:
							"https://github.com/acme/widget/issues/1#issuecomment-900",
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
			expect(releasePoll).not.toBeNull();
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

	test("each project reaches the event stream when its own poll ends", async () => {
		const releases = new Map<string, () => void>();
		const held = (name: string) =>
			new Promise<void>((resolve) => {
				releases.set(name, resolve);
			});
		const widgetHeld = held(repo);
		const otherHeld = held(otherRepo);
		const thirdHeld = held(thirdRepo);
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const listed = listedRead(input, init);
			if (listed !== null) {
				const heldFor =
					listed.repo === otherRepo
						? otherHeld
						: listed.repo === thirdRepo
							? thirdHeld
							: widgetHeld;
				await heldFor;
				return (
					issuesResponse(
						input,
						init,
						[ticket(1, "2026-04-01T00:00:00Z")],
						listed.repo,
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
					{ tracker: "github", repo: thirdRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				const stream = openEventStream(base);
				const timer = setTimeout(() => {
					stream.close();
					reject(
						new Error(
							`project event did not arrive within 3000ms (held ${[...releases.keys()].join(",")})`,
						),
					);
				}, 3_000);
				void (async () => {
					await stream.ready;
					releases.get(repo)?.();
					let sawWidget = false;
					let sawOther = false;
					for await (const event of stream.events) {
						const body = JSON.parse(event.data) as OverviewBody;
						const names = body.projects.map((project) => project.name);
						if (!sawWidget) {
							if (names.includes(otherRepo) || names.includes(thirdRepo)) {
								throw new Error(
									"a later project arrived before its poll ended",
								);
							}
							if (names.includes(repo)) {
								sawWidget = true;
								releases.get(otherRepo)?.();
							}
							continue;
						}
						if (!sawOther) {
							if (names.includes(thirdRepo)) {
								throw new Error("third project arrived before its poll ended");
							}
							if (names.includes(otherRepo)) {
								sawOther = true;
								releases.get(thirdRepo)?.();
							}
							continue;
						}
						if (!names.includes(thirdRepo) || body.polling === true) {
							continue;
						}
						expect(body.polling).toBeUndefined();
						break;
					}
					expect(sawWidget).toBe(true);
					expect(sawOther).toBe(true);
					clearTimeout(timer);
					stream.close();
					resolve();
				})().catch((error: unknown) => {
					clearTimeout(timer);
					stream.close();
					reject(error instanceof Error ? error : new Error("checks failed"));
				});
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
			for (const release of releases.values()) {
				release();
			}
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

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
			const held = listedRead(input, init);
			if (held !== null && held.repo === repo) {
				pushListed(requests, held);
				await pollHeld;
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
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const filler = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			{
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
							issuesResponse(input, init, [
								ticket(1, "2026-04-01T00:00:00Z"),
							]) ?? page([])
						);
					}
					return recordedOrEmpty(url) ?? unrecorded(input);
				},
				readGhToken: async () => null,
				databasePath,
				now: () => new Date(goodPoll),
				listTodos: async () => "",
				waitForStop: Promise.resolve(),
			},
		);
		expect(filler.exitCode).toBe(0);
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
					expect(
						requests.filter((url) => listUrl(url) !== null).length,
					).toBeGreaterThan(0);
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
	});

	test("an empty store exits 1 when every project poll fails", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const failing: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			return new Response("recorded failure", { status: 500 });
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: failing,
					readGhToken: async () => null,
					databasePath,
					waitForStop: new Promise<void>(() => {}),
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty store keeps serving when some project polls fail", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo },
					{ tracker: "github", repo: otherRepo },
				],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			const other = listedRead(input, init);
			if (other?.repo === otherRepo) {
				return new Response("recorded failure", { status: 500 });
			}
			if (other?.repo === repo) {
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<void>((resolve, reject) => {
			startChecks = (base: string) => {
				void (async () => {
					const deadline = Date.now() + 3_000;
					let body: OverviewBody = {
						projects: [],
						fetchedAt: null,
						error: null,
					};
					while (Date.now() < deadline) {
						body = (await (
							await fetch(new URL("/api/overview", base))
						).json()) as OverviewBody;
						if (body.projects.length === 2) {
							break;
						}
						await Bun.sleep(20);
					}
					expect(body.projects.map((project) => project.name).sort()).toEqual([
						otherRepo,
						repo,
					]);
					const failed = body.projects.find(
						(project) => project.name === otherRepo,
					);
					expect(failed?.error).toContain("HTTP 500");
					const served = body.projects.find((project) => project.name === repo);
					expect(served?.error).toBeNull();
					expect(served?.backlog).toBe(1);
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
			expect(result.listened).toBe(true);
		} finally {
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
			const kept = listedRead(input, init);
			if (kept !== null && kept.repo === repo) {
				requests.push(kept.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
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
			const stream = openEventStream(base);
			await stream.ready;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = await settledOverview(base, readOverview);
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
			const events = stream.events[Symbol.asyncIterator]();
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			expect(published).toEqual(body);
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
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				pushListed(requests, read);
				if (read.repo === otherRepo) {
					return new Response("   ", { status: 500 });
				}
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
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
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				requests.push(read.url);
				if (read.repo === otherRepo && !failedPins.has(read.repo)) {
					failedPins.add(read.repo);
					return new Response("recorded failure", { status: 500 });
				}
				return (
					issuesResponse(
						input,
						init,
						[ticket(1, "2026-04-01T00:00:00Z")],
						read.repo,
					) ?? page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
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
				// One poll shares one repository snapshot, so a start plus a
				// refresh is two reads. The refresh keeps the earlier pin's since.
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
								lane: "Backlog",
								statusType: "backlog",
								enteredStateAt: "2026-04-01T00:00:00Z",
								updatedAt: "2026-04-01T00:00:00Z",
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
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base, advance) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(first.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
					"WID-2",
				]);
				advance(10 * 60 * 1000);
				const again = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(again.status).toBe(204);
				expect(requests).toHaveLength(2);
				expect(requests.map(linearListSince)).toEqual([null, null]);
				const filters = requests
					.map(linearIssueFilter)
					.filter((filter) => filter !== null);
				expect(filters[1]?.updatedAt).toBeUndefined();
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
					or: [
						{ updatedAt: { gte: goodPoll } },
						{ comments: { updatedAt: { gte: goodPoll } } },
					],
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
			expect(lists.length).toBeGreaterThan(1);
			expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
				goodPoll,
			);
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
			expect(lists.length).toBeGreaterThan(1);
			expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
				goodPoll,
			);
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
			expect(lists.length).toBeGreaterThan(1);
			expect(new URL(lists[0] ?? "").searchParams.get("since")).toBeNull();
			expect(new URL(lists.at(-1) ?? "").searchParams.get("since")).toBe(
				goodPoll,
			);
		});
	});

	test("a recorded tracker change reaches a subscriber after one poll", async () => {
		const requests: string[] = [];
		await withServer(changingFetch(requests), 3600, async (base) => {
			const stream = openEventStream(base);
			await stream.ready;
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
			const eventBody = await settledOverview(base, readOverview);
			expect(eventBody.projects).toEqual([
				counts(
					repo,
					1,
					1,
					"github",
					[
						githubTicket(
							1,
							"done",
							"2026-04-02T00:00:00Z",
							"2026-04-02T00:00:00Z",
						),
						githubTicket(
							2,
							"backlog",
							"2026-04-02T00:00:00Z",
							"2026-04-02T00:00:00Z",
						),
					],
					"2026-04-01T12:00:01.000Z",
				),
			]);
			expect(eventBody.fetchedAt).toBe("2026-04-01T12:00:01.000Z");
			expect(eventBody.error).toBeNull();
			const events = stream.events[Symbol.asyncIterator]();
			const published = await settledOverviewEvent(events, overviewOf);
			stream.close();
			expect(published).toEqual(eventBody);
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

	test("a failed project with no stored rows gets its own empty card", async () => {
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
			const read = listedRead(input, init);
			if (read !== null && (read.repo === repo || read.repo === otherRepo)) {
				pushListed(requests, read);
				if (read.repo === otherRepo) {
					return new Response("recorded failure", { status: 500 });
				}
				return (
					issuesResponse(input, init, [ticket(1, "2026-04-01T00:00:00Z")]) ??
					page([])
				);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects.map((project) => project.name)).toEqual([
					repo,
					otherRepo,
				]);
				expect(body.projects[1]?.tickets).toEqual([]);
				expect(body.projects[1]?.error).toContain("HTTP 500");
				expect(body.projects[1]?.error).toContain(otherRepo);
				expect(body.error).toBeNull();
			},
			[
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
		);
	});

	test("a found Linear project stays after an incremental poll with no changes", async () => {
		const requests: string[] = [];
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const body =
				typeof init?.body === "string" ? init.body : JSON.stringify(init?.body);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === "https://api.linear.app/graphql") {
				if (body.includes("MemberProjects")) {
					return new Response(
						JSON.stringify({
							data: {
								viewer: { id: "lev" },
								projects: {
									nodes: [
										{
											id: "project-1",
											name: "Widget launch",
											slugId: linearProject,
											updatedAt: "2026-04-01T00:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("viewer")) {
					return new Response(
						JSON.stringify({ data: { viewer: { id: "lev" } } }),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				if (body.includes("ProjectByPin")) {
					return new Response(
						JSON.stringify({
							data: {
								projects: {
									nodes: [
										{
											id: "project-1",
											name: "Widget launch",
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
					const nodes = requests.length === 1 ? [linearIssue("1")] : [];
					return new Response(linearPage(nodes), {
						status: 200,
						headers: { "content-type": "application/json" },
					});
				}
			}
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(first.projects.map((project) => project.name)).toEqual([
					"Widget launch",
				]);
				expect(first.projects[0]?.tracker).toBe("linear");
				expect(first.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
				]);
				expect(first.error).toBeNull();
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				expect(requests.map(linearListSince)).toEqual([null, goodPoll]);
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects.map((project) => project.name)).toEqual([
					"Widget launch",
				]);
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
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

	test("a Linear progress comment edited in place reaches the next incremental poll", async () => {
		const requests: string[] = [];
		const createdAt = "2026-04-01T08:00:00.000Z";
		const firstEdit = "2026-04-01T10:04:00.000Z";
		const editedAt = "2026-04-01T12:05:10.000Z";
		const progress = (stage: string): Record<string, unknown> => ({
			id: "comment-progress",
			body: `**Workcell progress**\n\n- stage ${stage}: implementing`,
			createdAt,
			updatedAt: stage === "1" ? firstEdit : editedAt,
			user: { displayName: "workcell" },
			reactions: [],
		});
		const issue = (stage: string): Record<string, unknown> => ({
			...linearIssue("1"),
			title: "Live run",
			// Assume a comment edit leaves the issue updatedAt.
			updatedAt: createdAt,
			comments: {
				nodes: [progress(stage)],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
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
				const filter = linearIssueFilter(body);
				if (filter === null) {
					return new Response("not recorded", { status: 404 });
				}
				requests.push(body);
				const since = linearListSince(body);
				const nodes =
					filter.or?.some((branch) => branch.comments !== undefined) === true
						? [issue("4")]
						: since === null
							? [issue("1")]
							: [];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base, advance) => {
				const firstOverview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const first = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearProject)}`, base),
					)
				).json()) as { tickets: ShownTicket[] };
				expect(first.tickets[0]).toMatchObject({
					key: "WID-1",
					state: "inProgress",
					run: { status: "running", stage: "stage 1" },
				});
				expect(first.tickets[0]?.chips ?? []).not.toContain("Run failed");
				expect(firstOverview.error).toBeNull();
				advance(5 * 60 * 1000);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearProject)}`, base),
					)
				).json()) as { tickets: ShownTicket[] };
				const ticket = report.tickets[0];
				expect(ticket).toMatchObject({
					key: "WID-1",
					state: "inProgress",
					run: { status: "running", stage: "stage 4" },
				});
				expect(ticket?.chips ?? []).not.toContain("Run failed");
				expect(body.projects[0]?.tickets[0]?.state).toBe("inProgress");
				const needsYou = (await (
					await fetch(new URL("/api/needs-you", base))
				).json()) as { key: string; reason: string }[];
				expect(needsYou.filter((row) => row.key === "WID-1")).toEqual([]);
				expect(body.error).toBeNull();
				expect(requests.map(linearListSince)).toEqual([null, goodPoll]);
				const commentFilters = requests
					.map(linearIssueFilter)
					.filter((filter) =>
						filter?.or?.some((branch) => branch.comments !== undefined),
					);
				expect(commentFilters).toHaveLength(1);
				expect(commentFilters[0]?.updatedAt).toBeUndefined();
				expect(commentFilters[0]?.or).toEqual([
					{ updatedAt: { gte: goodPoll } },
					{ comments: { updatedAt: { gte: goodPoll } } },
				]);
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

	test("a GitHub progress comment edited in place reaches the next incremental poll", async () => {
		const requests: string[] = [];
		const issueUpdatedAt = "2026-04-01T08:00:00.000Z";
		const issue = {
			number: 192,
			title: "Live run",
			state: "open",
			state_reason: null,
			updated_at: issueUpdatedAt,
			created_at: "2026-04-01T07:00:00.000Z",
			html_url: `https://github.com/${repo}/issues/192`,
			comments: 1,
			body: "",
		};
		const storedCommentAt = "2026-04-01T10:04:00.000Z";
		const commentNode = (body: string, updatedAt: string) => ({
			databaseId: recordedProgressComment.id,
			body,
			createdAt: recordedProgressComment.created_at,
			updatedAt,
			author: { login: recordedProgressComment.user.login },
			reactions: { totalCount: 0 },
		});
		const recorded = {
			...recordedProgressComment,
			issue_url: `https://api.github.com/repos/${repo}/issues/192`,
			html_url: `https://github.com/${repo}/issues/192#issuecomment-${recordedProgressComment.id}`,
			updated_at: storedCommentAt,
		};
		const edited = {
			...recorded,
			issue_url: `https://api.github.com/repos/${repo.toUpperCase()}/issues/192`,
			body: `${recorded.body}\n- stage 4: implementing`,
			updated_at: "2026-04-01T12:05:10.000Z",
		};
		let commentReads = 0;
		const fetchImpl: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			const read = listedRead(input, init);
			if (read !== null) {
				pushListed(requests, read);
				const node = githubIssueNode({
					...issue,
					commentRows: [
						{
							id: recordedProgressComment.id,
							body: read.since === null ? recorded.body : edited.body,
							created_at: recordedProgressComment.created_at,
							updated_at:
								read.since === null ? storedCommentAt : edited.updated_at,
							user: { login: recordedProgressComment.user.login },
						},
					],
				});
				const comments = {
					nodes: [
						commentNode(
							read.since === null ? recorded.body : edited.body,
							read.since === null ? storedCommentAt : edited.updated_at,
						),
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				};
				node.comments = comments;
				const [owner, name] = read.repo.split("/");
				return new Response(
					JSON.stringify(
						repoReadIssues(
							owner ?? "acme",
							name ?? "widget",
							[node],
							read.since === null ? {} : { edited: [node] },
						),
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			requests.push(url);
			if (url === "https://api.github.com/user") {
				return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
			}
			if (url === `https://api.github.com/repos/${repo}`) {
				return Response.json({ allow_auto_merge: false });
			}
			if (url === `https://api.github.com/repos/${repo}/issues/192`) {
				return Response.json(issue);
			}
			if (url.includes("/issues/192/comments")) {
				commentReads += 1;
				return page([commentReads === 1 ? recorded : edited]);
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base, advance) => {
			const firstOverview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			const first = (await (
				await fetch(new URL(`/api/projects/${encodeURIComponent(repo)}`, base))
			).json()) as { tickets: ShownTicket[] };
			expect(first.tickets[0]).toMatchObject({
				key: `${repo}#192`,
				state: "inProgress",
				run: { status: "running", stage: "stage 2" },
			});
			expect(first.tickets[0]?.chips ?? []).not.toContain("Run failed");
			expect(firstOverview.error).toBeNull();
			advance(2 * 60 * 60 * 1000);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			const report = (await (
				await fetch(new URL(`/api/projects/${encodeURIComponent(repo)}`, base))
			).json()) as { tickets: ShownTicket[] };
			const ticket = report.tickets[0];
			expect(ticket).toMatchObject({
				key: `${repo}#192`,
				state: "inProgress",
				run: { status: "running", stage: "stage 4" },
			});
			expect(ticket?.chips ?? []).not.toContain("Run failed");
			expect(body.projects[0]?.tickets[0]?.state).toBe("inProgress");
			const needsYou = (await (
				await fetch(new URL("/api/needs-you", base))
			).json()) as { key: string; reason: string }[];
			expect(needsYou.filter((row) => row.key === `${repo}#192`)).toEqual([]);
			expect(body.error).toBeNull();
			const lists = requests.filter((item) => listUrl(item) !== null);
			expect(lists).toHaveLength(2);
			expect(new URL(lists[1] ?? "").searchParams.get("since")).toBe(goodPoll);
			expect(
				requests.some(
					(item) =>
						item.includes("query RepoRead") || item.includes("/issues?"),
				),
			).toBe(true);
		});
	});

	test("an edited comment with a blank issue link leaves the stored ticket", async () => {
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
			const blank = listedRead(input, init);
			if (blank !== null && blank.repo === repo) {
				requests.push(blank.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			if (url.includes(`/repos/${repo}/issues/comments?`)) {
				requests.push(url);
				return page([
					{
						id: 1,
						issue_url: "   ",
						body: "   ",
						updated_at: "2026-04-01T12:05:00.000Z",
					},
					{
						id: 2,
						issue_url: `https://api.github.com/repos/${otherRepo}/issues/9`,
						body: "edited elsewhere",
						updated_at: "2026-04-01T12:05:00.000Z",
					},
				]);
			}
			if (/\/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)) {
				requests.push(url);
				return new Response("recorded failure", { status: 500 });
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			expect(body.projects[0]?.tickets).toEqual([githubTicket(1, "backlog")]);
			expect(body.error).toBeNull();
			expect(requests.filter((url) => /\/issues\/\d+$/.test(url))).toEqual([]);
		});
	});

	test("a missing edited issue leaves the stored tickets", async () => {
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
			const missing = listedRead(input, init);
			if (missing !== null && missing.repo === repo) {
				requests.push(missing.url);
				polls += 1;
				return (
					issuesResponse(
						input,
						init,
						polls === 1 ? [ticket(1, "2026-04-01T00:00:00Z")] : [],
					) ?? page([])
				);
			}
			if (url.includes(`/repos/${repo}/issues/comments?`)) {
				return page([
					{
						id: 3,
						issue_url: `https://api.github.com/repos/${repo}/issues/404`,
						body: "**Workcell progress**\n\n- stage 4: implementing",
						updated_at: "2026-04-01T12:05:00.000Z",
						user: { login: "lev" },
					},
				]);
			}
			if (url === `https://api.github.com/repos/${repo}/issues/404`) {
				requests.push(url);
				return new Response("not found", { status: 404 });
			}
			return recordedOrEmpty(url) ?? unrecorded(input);
		};
		await withServer(fetchImpl, 3600, async (base) => {
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const body = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as OverviewBody;
			expect(body.projects[0]?.tickets.map((item) => item.key)).toEqual([
				`${repo}#1`,
			]);
			expect(body.error).toBeNull();
			expect(
				requests.filter((url) => listUrl(url) !== null).length,
			).toBeGreaterThan(0);
			expect(
				requests.filter((url) => url.endsWith("/issues/404")),
			).toHaveLength(0);
		});
	});

	test("an incremental Linear poll keeps stored PRs of untouched tickets", async () => {
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
			if (url.includes("/pulls?state=closed") || url.includes("/labels?")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url === "https://api.github.com/graphql") {
				const sent = typeof init?.body === "string" ? init.body : "";
				if (sent.includes("query RepoRead")) {
					return new Response(
						JSON.stringify(
							repoReadIssues("acme", "widget", [], {
								pulls: [
									{
										number: 7,
										title: "Stored pull",
										url: "https://github.com/acme/widget/pull/7",
										isDraft: true,
										body: "closes acme/widget#1",
										state: "OPEN",
										mergedAt: null,
										headRefName: "wid-1",
										headRefOid: "sha-7",
										closingIssuesReferences: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reviews: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										comments: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
										reactions: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									},
								],
							}),
						),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
			}
			if (url.startsWith("https://api.github.com/repos/acme/widget/pulls/7")) {
				requests.push(url);
				return new Response(
					JSON.stringify({
						number: 7,
						title: "Stored pull",
						html_url: "https://github.com/acme/widget/pull/7",
						draft: true,
						body: "closes acme/widget#1",
						head: { ref: "wid-1", sha: "sha-7" },
						state: "open",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
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
						? [
								{
									...linearIssue("1"),
									title: "Linear ticket 1",
									attachments: {
										nodes: [
											{
												url: "https://github.com/acme/widget/pull/7",
												title: "Stored pull",
												sourceType: "github",
											},
										],
									},
								},
								linearIssue("2"),
							]
						: [linearIssue("2")];
				return new Response(linearPage(nodes), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		};
		await withServer(
			fetchImpl,
			3600,
			async (base) => {
				const first = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					first.projects[0]?.tickets.map((ticket) => ticket.state),
				).toEqual(["inProgress", "backlog"]);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(body.projects[0]?.tickets.map((ticket) => ticket.key)).toEqual([
					"WID-1",
					"WID-2",
				]);
				expect(body.projects[0]?.tickets.map((ticket) => ticket.state)).toEqual(
					["inProgress", "backlog"],
				);
				expect(requests.filter((url) => url.includes("/pulls/7"))).toHaveLength(
					1,
				);
			},
			[{ tracker: "linear", project: linearProject }],
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
		);
	});

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
