import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeedsYouItem } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;
const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

type Sent = { url: string; method: string; body: string };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function issue(number: number, comments = 1): Record<string, unknown> {
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

function githubFetch(
	sent: Sent[],
	options: {
		issues: Record<string, unknown>[];
		comments?: Record<number, Record<string, unknown>[]>;
		reviewComments?: Record<number, Record<string, unknown>[]>;
		failReply?: boolean;
	},
): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const method =
			init?.method ?? (input instanceof Request ? input.method : "GET");
		const body = typeof init?.body === "string" ? init.body : "";
		if (method !== "GET" && method !== "HEAD") {
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
		const oneIssue = url.match(/\/repos\/acme\/widget\/issues\/(\d+)$/);
		if (oneIssue !== null && method === "GET") {
			const number = Number(oneIssue[1]);
			const found = options.issues.find((item) => item.number === number);
			if (found === undefined) {
				return new Response("not recorded", { status: 404 });
			}
			return json({
				...found,
				html_url: `https://github.com/acme/widget/issues/${number}`,
			});
		}
		const comments = url.match(
			/\/repos\/acme\/widget\/issues\/(\d+)\/comments(?:\?|$)/,
		);
		if (comments !== null && method === "GET") {
			const number = Number(comments[1]);
			return json(options.comments?.[number] ?? []);
		}
		if (comments !== null && method === "POST") {
			if (options.failReply === true) {
				return new Response("recorded failure", { status: 422 });
			}
			const posted = JSON.parse(body) as { body?: string };
			return json(
				{
					id: 900,
					body: posted.body ?? "",
					html_url: "https://github.com/acme/widget/issues/7#issuecomment-900",
					created_at: "2026-08-18T13:00:00.000Z",
					user: { login: "lev" },
				},
				201,
			);
		}
		const review = url.match(
			/\/repos\/acme\/widget\/pulls\/(\d+)\/comments(?:\?|$)/,
		);
		if (review !== null && method === "GET") {
			const number = Number(review[1]);
			return json(options.reviewComments?.[number] ?? []);
		}
		if (review !== null && method === "POST") {
			if (options.failReply === true) {
				return new Response("recorded failure", { status: 422 });
			}
			const posted = JSON.parse(body) as { body?: string };
			return json(
				{
					id: 901,
					body: posted.body ?? "",
					html_url: "https://github.com/acme/widget/pull/8#discussion_r901",
					created_at: "2026-08-18T13:00:00.000Z",
					user: { login: "lev" },
					in_reply_to_id: 44,
				},
				201,
			);
		}
		if (url.includes("/pulls?")) {
			return json([]);
		}
		if (url.includes("/branches?")) {
			return json([]);
		}
		if (url === "https://api.linear.app/graphql") {
			return json({ data: { viewer: { id: "lev" } } });
		}
		return new Response("not recorded", { status: 404 });
	};
}

async function serve(
	fetchImpl: Fetch,
	config: string,
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

describe("replies", () => {
	test("a GitHub issue reply posts a plain new comment", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "Use the short name.",
				}),
			});
			expect(response.status).toBe(201);
			const created = (await response.json()) as {
				body: string;
				url: string;
			};
			expect(created.body).toBe("Use the short name.");
			expect(created.url).toBe(
				"https://github.com/acme/widget/issues/7#issuecomment-900",
			);
			const posted = sent.find(
				(item) =>
					item.method === "POST" &&
					item.url ===
						"https://api.github.com/repos/acme/widget/issues/7/comments",
			);
			expect(posted?.body).toBe(
				JSON.stringify({ body: "Use the short name." }),
			);
		} finally {
			await app.stop();
		}
	});

	test("a PR review reply posts into that review thread", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(8, 0)],
			reviewComments: {
				8: [
					{
						id: 44,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r44",
						path: "src/app.ts",
						in_reply_to_id: null,
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#8",
					parentId: "44",
					kind: "review",
					body: "Renamed.",
				}),
			});
			expect(response.status).toBe(201);
			const posted = sent.find(
				(item) =>
					item.method === "POST" &&
					item.url ===
						"https://api.github.com/repos/acme/widget/pulls/8/comments",
			);
			expect(JSON.parse(posted?.body ?? "{}")).toEqual({
				body: "Renamed.",
				in_reply_to: 44,
			});
		} finally {
			await app.stop();
		}
	});

	test("a Linear reply posts into that comment thread", async () => {
		const sent: string[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Open ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-parent",
								body: `Which name?\n\n${ask("pf-1")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
						],
					},
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-1",
					parentId: "comment-parent",
					body: "Use the short name.",
				}),
			});
			expect(response.status).toBe(201);
			const created = (await response.json()) as { body: string };
			expect(created.body).toBe("Use the short name.");
			const posted = sent.find((body) => body.includes("commentCreate"));
			expect(posted).toBeDefined();
			const parsed = JSON.parse(posted ?? "{}") as {
				variables?: {
					input?: { issueId?: string; parentId?: string; body?: string };
				};
			};
			expect(parsed.variables?.input).toEqual({
				issueId: "PF-1",
				parentId: "comment-parent",
				body: "Use the short name.",
			});
		} finally {
			await app.stop();
		}
	});

	test("a missing ticket and a repeated-space reply send no comment", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, { issues: [issue(7)] });
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const missing = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#404",
					body: "Nowhere.",
				}),
			});
			expect(missing.status).toBe(404);
			const spaced = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "  Use the short name.  ",
				}),
			});
			expect(spaced.status).toBe(201);
			const posted = sent.find(
				(item) =>
					item.method === "POST" && item.url.includes("/issues/7/comments"),
			);
			expect(JSON.parse(posted?.body ?? "{}")).toEqual({
				body: "  Use the short name.  ",
			});
			expect(sent.some((item) => item.url.includes("/issues/404/"))).toBe(
				false,
			);
		} finally {
			await app.stop();
		}
	});

	test("a blank reply sends no tracker request", async () => {
		const sent: string[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-blank",
					identifier: "PF-BLANK",
					title: "Blank",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-BLANK",
					body: "   ",
				}),
			});
			expect(response.status).toBe(400);
			expect(sent.some((body) => body.includes("commentCreate"))).toBe(false);
		} finally {
			await app.stop();
		}
	});

	test("a failed reply returns the tracker error", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			failReply: true,
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "Keep this text.",
				}),
			});
			expect(response.status).toBe(422);
			const failed = (await response.json()) as { error: string };
			expect(failed.error).toContain("HTTP 422");
			expect(failed.error).not.toContain("Keep this text.");
		} finally {
			await app.stop();
		}
	});

	test("a posted reply marks the ask answered until an agent reacts", async () => {
		const sent: string[] = [];
		const question = "Which name?";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-11",
					identifier: "PF-11",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-11",
								body: `${question}\n\n${ask("pf-11")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
						],
					},
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const before = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(before.find((item) => item.key === "PF-11")).toMatchObject({
				answered: false,
				acknowledged: false,
			});
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-11",
					parentId: "comment-ask-11",
					body: "Use the short name.",
				}),
			});
			expect(posted.status).toBe(201);
			const after = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(after.find((item) => item.key === "PF-11")).toMatchObject({
				answered: true,
				acknowledged: false,
			});
		} finally {
			await app.stop();
		}
	});

	test("a reply after the latest ask is answered, and a reaction acknowledges it", async () => {
		const sent: string[] = [];
		const question = "Which name?";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-9",
					identifier: "PF-9",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask",
								body: `${question}\n\n${ask("pf-9")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
							{
								id: "comment-reply",
								body: "Use the short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								user: { name: "Lev" },
								reactions: [{ id: "reaction-1" }],
							},
						],
					},
				},
				{
					id: "issue-pf-10",
					identifier: "PF-10",
					title: "Answered only",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-10",
								body: `${ask("pf-10")}\n${question}`,
								createdAt: "2026-08-18T12:00:00.000Z",
							},
							{
								id: "comment-reply-10",
								body: "Use the short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								user: { name: "Lev" },
								reactions: [],
							},
						],
					},
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(new URL("/api/needs-you", app.base));
			expect(response.status).toBe(200);
			const items = (await response.json()) as NeedsYouItem[];
			expect(items.find((item) => item.key === "PF-9")).toMatchObject({
				answered: true,
				acknowledged: true,
			});
			expect(items.find((item) => item.key === "PF-10")).toMatchObject({
				answered: true,
				acknowledged: false,
			});
		} finally {
			await app.stop();
		}
	});
});
