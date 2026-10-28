import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo } from "./support/app.ts";
import { json, urlOf } from "./support/fetch.ts";
import { recordedDiscovery, unrecorded } from "./support/github.ts";
import { repoReadFromLists } from "./support/repo-read.ts";

export { json };

export { unrecorded, urlOf };

export type Sent = { url: string; method: string; body: string };

export function issue(number: number, comments = 1): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "Body",
		comments,
		labels: [],
		assignee: null,
	};
}

export function githubFetch(
	sent: Sent[],
	options: {
		issues: Record<string, unknown>[];
		comments?: Record<number, Record<string, unknown>[]>;
		reviewComments?: Record<number, Record<string, unknown>[]>;
		failReply?: boolean;
		failThread?: boolean;
		hangThread?: boolean;
		holdUntilPeer?: (url: string, release: () => void) => void;
		graphql?: (query: string) => Response | null;
	},
): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const method =
			init?.method ?? (input instanceof Request ? input.method : "GET");
		const body = typeof init?.body === "string" ? init.body : "";
		if (url.startsWith("https://api.github.com/")) {
			sent.push({ url, method, body });
		}
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (url.startsWith("https://api.github.com/repos/acme/widget/issues?")) {
			return json(options.issues);
		}
		const oneIssue = url.match(/\/repos\/(acme\/widget)\/issues\/(\d+)$/);
		if (oneIssue !== null && method === "GET") {
			if (options.hangThread === true) {
				return new Promise<Response>(() => {});
			}
			if (options.failThread === true) {
				return new Response("upstream down", { status: 502 });
			}
			const number = Number(oneIssue[2]);
			const found = options.issues.find((item) => item.number === number);
			if (found === undefined) {
				return unrecorded(input);
			}
			return json({
				...found,
				html_url: `https://github.com/acme/widget/issues/${number}`,
			});
		}
		const comments = url.match(
			/\/repos\/acme\/widget\/issues\/(\d+)\/comments(?:\?([^#]*))?$/,
		);
		if (comments !== null && method === "GET") {
			if (options.hangThread === true) {
				return new Promise<Response>(() => {});
			}
			if (options.holdUntilPeer !== undefined) {
				await new Promise<void>((resolve) => {
					options.holdUntilPeer?.(url, resolve);
				});
			}
			const number = Number(comments[1]);
			const page = Number(new URL(url).searchParams.get("page") ?? "1");
			const rows = options.comments?.[number] ?? [];
			if (page === 1 && rows.length > 100) {
				return json(rows.slice(0, 100), 200, {
					link: `<https://api.github.com/repos/acme/widget/issues/${number}/comments?per_page=100&page=2>; rel="next"`,
				});
			}
			return json(page === 1 ? rows : rows.slice(100));
		}
		if (comments !== null && method === "POST") {
			const number = Number(comments[1]);
			if (options.issues.every((item) => item.number !== number)) {
				return unrecorded(input);
			}
			if (options.failReply === true) {
				return new Response("recorded failure", { status: 422 });
			}
			const posted = JSON.parse(body) as { body?: string };
			const created = {
				id: 900,
				body: posted.body ?? "",
				html_url: "https://github.com/acme/widget/issues/7#issuecomment-900",
				created_at: "2026-08-18T13:00:00.000Z",
				user: { login: "lev" },
			};
			const rows = options.comments?.[number] ?? [];
			options.comments ??= {};
			options.comments[number] = [...rows, created];
			return json(created, 201);
		}
		const review = url.match(
			/\/repos\/acme\/widget\/pulls\/(\d+)\/comments(?:\?([^#]*))?$/,
		);
		if (review !== null && method === "GET") {
			const number = Number(review[1]);
			const page = Number(new URL(url).searchParams.get("page") ?? "1");
			const rows = options.reviewComments?.[number] ?? [];
			if (page === 1 && rows.length > 100) {
				return json(rows.slice(0, 100), 200, {
					link: `<https://api.github.com/repos/acme/widget/pulls/${number}/comments?per_page=100&page=2>; rel="next"`,
				});
			}
			return json(page === 1 ? rows : rows.slice(100));
		}
		if (review !== null && method === "POST") {
			const number = Number(review[1]);
			if (options.failReply === true) {
				return new Response("recorded failure", { status: 422 });
			}
			const posted = JSON.parse(body) as {
				body?: string;
				in_reply_to?: number;
			};
			const created = {
				id: 901,
				body: posted.body ?? "",
				html_url: "https://github.com/acme/widget/pull/8#discussion_r901",
				created_at: "2026-08-18T13:00:00.000Z",
				user: { login: "lev" },
				in_reply_to_id: posted.in_reply_to ?? null,
			};
			const rows = options.reviewComments?.[number] ?? [];
			options.reviewComments ??= {};
			options.reviewComments[number] = [...rows, created];
			return json(created, 201);
		}
		if (url === "https://api.github.com/graphql" && method === "POST") {
			if (options.holdUntilPeer !== undefined && body.includes("LinkedPulls")) {
				await new Promise<void>((resolve) => {
					options.holdUntilPeer?.(url, resolve);
				});
			}
			const read = repoReadFromLists(input, init, {
				"acme/widget": options.issues.map((item) => ({
					...item,
					commentRows: options.comments?.[Number(item.number)] ?? [],
				})),
			});
			if (read !== null) {
				return read;
			}
			const query = JSON.parse(body) as { query?: string };
			const answered = options.graphql?.(query.query ?? "");
			if (answered !== undefined && answered !== null) {
				return answered;
			}
		}
		if (url.includes("/pulls?") || url.includes("/labels?")) {
			return json([]);
		}
		if (url.includes("/branches?")) {
			return json([]);
		}
		if (url === "https://api.linear.app/graphql") {
			return json({ data: { viewer: { id: "lev" } } });
		}
		return unrecorded(input);
	};
}

export async function serve(
	fetchImpl: Fetch,
	config: string,
	options?: { threadReadLimitMs?: number; trackerRequestLimitMs?: number },
): Promise<{ base: string; stop: () => Promise<void> }> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	await writeFile(join(root, "notes.txt"), "untracked harness file\n");
	let startChecks: (base: string) => void = () => {};
	const ready = new Promise<string>((resolve) => {
		startChecks = resolve;
	});
	const stopped = new Promise<void>((resolve) => {
		void ready.then(() => {
			stop = async () => {
				resolve();
				await cleanup();
				await rm(root, { recursive: true, force: true });
			};
		});
	});
	let stop: () => Promise<void> = async () => {};
	const running = run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: {
				GITHUB_TOKEN: "recorded-github-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
			fetch: fetchImpl,
			...(options?.threadReadLimitMs === undefined
				? {}
				: { threadReadLimitMs: options.threadReadLimitMs }),
			...(options?.trackerRequestLimitMs === undefined
				? {}
				: { trackerRequestLimitMs: options.trackerRequestLimitMs }),
			readGhToken: async () => null,
			databasePath: join(root, "store.sqlite"),
			stdout: (line) => startChecks(line),
			stderr: (line) => {
				throw new Error(line);
			},
			waitForStop: stopped,
		}),
	);
	const base = await ready;
	return {
		base,
		stop: async () => {
			await stop();
			const result = await running;
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
		},
	};
}
