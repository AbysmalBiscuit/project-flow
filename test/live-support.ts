import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	type ChangeEvent,
	githubIssueNode,
	repoReadIssues,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

export const repo = "acme/widget";
export const otherRepo = "acme/other";

export function ticket(
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

export function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

export function recordedOrEmpty(url: string): Response | null {
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

export type ListedRead = {
	url: string;
	since: string | null;
	repo: string;
	poll: string;
};

export function listedRead(
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

export function listUrl(url: string, name = repo): URL | null {
	const parsed = new URL(url);
	if (parsed.origin !== "https://api.github.com") {
		return null;
	}
	if (parsed.pathname !== `/repos/${name}/issues`) {
		return null;
	}
	return parsed;
}

export function issuesResponse(
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

export function overviewOf(data: string): OverviewBody {
	return JSON.parse(data) as OverviewBody;
}

export async function readOverview(base: string): Promise<OverviewBody> {
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

export function openEventStream(base: string): {
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

export const goodPoll = "2026-04-01T12:00:00.000Z";

export type ShownTicket = {
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

export type OverviewBody = {
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
		pending?: boolean;
		statusTypes: Record<string, number>;
		ref:
			| { tracker: "github"; repo: string }
			| { tracker: "linear"; project: string };
	}[];
	fetchedAt: string | null;
	error: string | null;
	polling?: true;
};

export async function withServer(
	fetchImpl: Fetch,
	intervalSeconds: number,
	checks: (base: string, advance: (ms: number) => void) => Promise<void>,
	pinned: (
		{ tracker: "github"; repo: string } | { tracker: "linear"; project: string }
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
	let startChecks: (
		base: string,
		advance: (ms: number) => void,
	) => void = () => {};
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
