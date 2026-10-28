import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { eventsOf } from "../events.ts";
import { tempConfig, testIo } from "../support/app.ts";
import {
	type TrackerRequest,
	trackerRequest,
	urlOf,
} from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import { settledOverview } from "../support/reads.ts";

export const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

export const linearProject = {
	id: "project-flow",
	name: "Project Flow",
	slugId: "project-flow",
};

export type InboxEntry = {
	id: string;
	trigger: "needsYou" | "comment" | "blockerCleared";
	project: string;
	key: string;
	text: string;
	at: string;
	read: boolean;
	day: "today" | "yesterday" | "earlier";
	tracker: "github" | "linear";
};

export function linearIssue(
	identifier: string,
	title: string,
	description: string,
	comments: {
		body: string;
		createdAt?: string;
		user?: { name: string };
	}[] = [],
	fields: Record<string, unknown> = {},
	updatedAt = "2026-08-18T12:00:00.000Z",
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title,
		description,
		state: { type: "unstarted" },
		updatedAt,
		labels: { nodes: [] },
		comments: { nodes: comments },
		assignee: null,
		...fields,
	};
}

export function recordedIssues(issues: Record<string, unknown>[]): Response {
	return Response.json({
		data: {
			issues: {
				nodes: issues,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

export function bodyOf(init?: RequestInit): string {
	return typeof init?.body === "string" ? init.body : "";
}

export function isPinQuery(
	input: string | URL | Request,
	init?: RequestInit,
): boolean {
	return (
		urlOf(input) === "https://api.linear.app/graphql" &&
		bodyOf(init).includes("ProjectByPin")
	);
}

export function isIssueQuery(
	input: string | URL | Request,
	init?: RequestInit,
): boolean {
	return (
		urlOf(input) === "https://api.linear.app/graphql" &&
		bodyOf(init).includes("ProjectIssues")
	);
}

async function openEvents(base: string) {
	const response = await fetch(new URL("/api/events", base), {
		headers: { accept: "text/event-stream" },
	});
	const reader = response.body?.getReader();
	if (reader === undefined) {
		throw new Error("event stream has no body");
	}
	const decoder = new TextDecoder();
	const opened = await reader.read();
	if (!decoder.decode(opened.value).includes(": open")) {
		await reader.cancel();
		throw new Error("event stream did not open");
	}
	return {
		cancel: () => reader.cancel(),
		read: async () => {
			const chunk = await reader.read();
			if (chunk.done) {
				return null;
			}
			return decoder.decode(chunk.value, { stream: true });
		},
	};
}

type EventStream = Awaited<ReturnType<typeof openEvents>>;

async function drivenPoll(
	base: string,
	releasePoll?: () => void,
): Promise<InboxEntry | null> {
	const stream = await openEvents(base);
	try {
		const before = await inboxOf(base);
		releasePoll?.();
		await refresh(base);
		const after = await inboxOf(base);
		const raised = after.find(
			(entry) => !before.some((earlier) => earlier.id === entry.id),
		);
		if (raised === undefined) {
			return null;
		}
		let buffered = "";
		while (streamedNotification(buffered, raised.id) === undefined) {
			const chunk = await stream.read();
			if (chunk === null) {
				break;
			}
			buffered += chunk;
		}
		const streamed = streamedNotification(buffered, raised.id);
		if (streamed === undefined) {
			throw new Error("notification event missing for the raised inbox entry");
		}
		return streamed;
	} finally {
		await stream.cancel();
	}
}

async function quietPoll(base: string): Promise<void> {
	const before = await inboxOf(base);
	const stream = await openEvents(base);
	try {
		await refresh(base);
		const after = await inboxOf(base);
		const raised = after.find(
			(entry) => !before.some((earlier) => earlier.id === entry.id),
		);
		if (raised !== undefined) {
			throw new Error("inbox gained an entry on a quiet poll");
		}
		const events = eventsOf(await pollText(stream));
		for (const event of events) {
			if (event.event === "notification") {
				throw new Error("notification event arrived on a quiet poll");
			}
		}
		if (!events.some((event) => event.event === "overview")) {
			throw new Error("quiet poll ended before its overview event");
		}
	} finally {
		await stream.cancel();
	}
}

// The server writes the overview chunk, then each notification chunk.
// A gap shorter than this still belongs to the same poll.
const pollIdleMs = 50;

async function pollText(stream: EventStream): Promise<string> {
	let buffered = "";
	const readOne = (): Promise<string | null> => {
		let settled = false;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!settled) {
					resolve(null);
				}
			}, pollIdleMs);
			stream.read().then(
				(chunk) => {
					settled = true;
					clearTimeout(timer);
					resolve(chunk);
				},
				(error: unknown) => {
					settled = true;
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	};
	let chunk = await readOne();
	while (chunk !== null) {
		buffered += chunk;
		chunk = await readOne();
	}
	return buffered;
}

function streamedNotification(
	text: string,
	id: string,
): InboxEntry | undefined {
	const event = eventsOf(text).find(
		(item) =>
			item.event === "notification" &&
			(JSON.parse(item.data) as InboxEntry).id === id,
	);
	if (event === undefined) {
		return undefined;
	}
	return JSON.parse(event.data) as InboxEntry;
}

export async function withInbox(
	config: unknown,
	issues: Record<string, unknown>[],
	checks: (
		base: string,
		setIssues: (next: Record<string, unknown>[]) => void,
		failComments: (failed: boolean) => void,
		requests: TrackerRequest[],
	) => Promise<void>,
	projects: { id: string; name: string; slugId: string }[] = [linearProject],
): Promise<void> {
	let current = issues;
	let commentsFail = false;
	const requests: TrackerRequest[] = [];
	const recorded = linearFake({
		project: projects[0] ?? linearProject,
	});
	const fetchImpl: Fetch = async (input, init) => {
		requests.push(trackerRequest(input, init));
		if (
			commentsFail &&
			urlOf(input) === "https://api.linear.app/graphql" &&
			bodyOf(init).includes("IssueComments")
		) {
			return new Response("recorded failure", { status: 500 });
		}
		if (isIssueQuery(input, init)) {
			const body = bodyOf(init);
			const projectId = body.match(/"project":\{"id":\{"eq":"([^"]+)"/)?.[1];
			const project = projects.find((item) => item.id === projectId);
			const nodes = current.filter(
				(issue) =>
					issue.projectId === undefined || issue.projectId === projectId,
			);
			return recordedIssues(
				project === undefined
					? nodes
					: nodes.map((issue) => ({ ...issue, projectId: undefined })),
			);
		}
		if (isPinQuery(input, init)) {
			const slug = bodyOf(init).match(/"pin":"([^"]+)"/)?.[1];
			const project = projects.find((item) => item.slugId === slug) ?? null;
			return Response.json({
				data: { projects: { nodes: project === null ? [] : [project] } },
			});
		}
		return recorded(input, init);
	};
	const { path, cleanup } = await tempConfig(JSON.stringify(config));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			checks(
				base,
				(next) => {
					current = next;
				},
				(failed) => {
					commentsFail = failed;
				},
				requests,
			).then(resolve, reject);
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
}

export const pinned = {
	pinned: [{ tracker: "linear", project: "project-flow" }],
	pollIntervalSeconds: 3600,
};

export const gate = {
	id: "project-gate",
	name: "Gate",
	slugId: "gate",
};

export const blockerHeadline = "Open the gate";

export const blocked = {
	...linearIssue(
		"PF-2",
		"Hold the launch",
		"Blocked by: GATE-9",
		[],
		{},
		"2026-08-18T12:00:00.000Z",
	),
	projectId: linearProject.id,
};

export const blocker = {
	...linearIssue(
		"GATE-9",
		blockerHeadline,
		"",
		[],
		{ state: { type: "started" } },
		"2026-08-18T12:00:00.000Z",
	),
	projectId: gate.id,
};

export const twoProjects = {
	pinned: [
		{ tracker: "linear", project: "project-flow" },
		{ tracker: "linear", project: "gate" },
	],
	pollIntervalSeconds: 3600,
};

export async function notificationAfterRefresh(
	base: string,
	releasePoll?: () => void,
): Promise<InboxEntry> {
	const polled = await drivenPoll(base, releasePoll);
	if (polled === null) {
		throw new Error("no notification event on the driven poll");
	}
	return polled;
}

export async function expectQuietRefresh(base: string): Promise<void> {
	await quietPoll(base);
}

export async function quietUntil(
	base: string,
	settled: () => Promise<boolean>,
): Promise<void> {
	const attempts = 8;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await expectQuietRefresh(base);
		if (await settled()) {
			return;
		}
	}
	throw new Error("driven poll did not apply");
}

export async function refresh(base: string): Promise<void> {
	const response = await fetch(new URL("/api/refresh", base), {
		method: "POST",
	});
	expect(response.status).toBe(204);
	await settledOverview(base, async (url) => {
		return (await (await fetch(new URL("/api/overview", url))).json()) as {
			polling?: true;
		};
	});
}

export async function inboxOf(base: string): Promise<InboxEntry[]> {
	const response = await fetch(new URL("/api/inbox", base));
	expect(response.status).toBe(200);
	return ((await response.json()) as InboxEntry[]).map((entry) => {
		const { day: _day, tracker: _tracker, ...notification } = entry;
		return notification as InboxEntry;
	});
}

export async function markRead(
	base: string,
	id?: string,
	ids?: readonly string[],
): Promise<Response> {
	const path =
		id === undefined ? "/api/inbox" : `/api/inbox/${encodeURIComponent(id)}`;
	const body =
		id === undefined ? { read: true, ids: ids ?? [] } : { read: true };
	return fetch(new URL(path, base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
