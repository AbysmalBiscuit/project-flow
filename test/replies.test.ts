import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeedsYouItem, Thread } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;
const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

type Sent = { url: string; method: string; body: string };

function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
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
			expect(created.body).toBe("> Which name?\n\nUse the short name.");
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
				body: "> Which name?\n\nUse the short name.",
			});
		} finally {
			await app.stop();
		}
	});

	test("a missing ticket sends no comment and a spaced body posts", async () => {
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
				body: "Use the short name.",
			});
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
					body: "Reply: the short name.",
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
								user: { name: "Lev" },
							},
							{
								id: "comment-reply",
								body: "Reply: the short name.",
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
								user: { name: "Lev" },
							},
							{
								id: "comment-reply-10",
								body: "Reply: the short name.",
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

	test("a thread longer than 100 comments keeps the newest comment", async () => {
		const sent: Sent[] = [];
		const comments = Array.from({ length: 101 }, (_, index) => ({
			id: index + 1,
			body: `Note ${index + 1}`,
			user: { login: "ada" },
			created_at: "2026-08-18T12:00:00.000Z",
			html_url: `https://github.com/acme/widget/issues/7#issuecomment-${index + 1}`,
		}));
		const recorded = githubFetch(sent, {
			issues: [issue(7, 101)],
			comments: { 7: comments },
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments).toHaveLength(101);
			expect(thread.comments.at(-1)?.body).toBe("Note 101");
			expect(
				sent.some((item) =>
					item.url.includes("/issues/7/comments?per_page=100&page=2"),
				),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a missing Linear issue shows thread not found", async () => {
		const recorded = linearFake({
			project: linearProject,
			issues: [],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(
				new URL("/api/threads/linear/PF-404?project=widget-launch", app.base),
			);
			expect(response.status).toBe(404);
			const failed = (await response.json()) as { error: string };
			expect(failed.error).toBe("thread not found");
		} finally {
			await app.stop();
		}
	});

	test("a thread hides the workcell marker from the rendered body", async () => {
		const recorded = githubFetch([], {
			issues: [issue(7)],
			comments: {
				7: [
					{
						id: 71,
						body: "Which name?\n\n<!-- workcell:ask 7-1 -->",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/7#issuecomment-71",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments[0]?.body).toBe("Which name?");
			expect(thread.comments[0]?.body).not.toContain("workcell:ask");
		} finally {
			await app.stop();
		}
	});

	test("a GitHub issue thread returns the tracker URL", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(7)],
			comments: {
				7: [
					{
						id: 70,
						body: "Which name?",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/7#issuecomment-70",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%237?project=Widget%20board",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://github.com/acme/widget/issues/7");
			expect(sent.some((item) => item.url.includes("widget-board"))).toBe(
				false,
			);
			expect(
				sent.some(
					(item) =>
						item.url === "https://api.github.com/repos/acme/widget/issues/7",
				),
			).toBe(true);
			expect(thread.comments).toEqual([
				{
					id: "70",
					body: "Which name?",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/issues/7#issuecomment-70",
					parentId: null,
					kind: "comment",
					children: [],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a PR review thread nests the reply under its parent", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [{ ...issue(8, 0), pull_request: { url: "recorded" } }],
			reviewComments: {
				8: [
					{
						id: 44,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r44",
						in_reply_to_id: null,
					},
					{
						id: 45,
						body: "Renamed.",
						user: { login: "lev" },
						created_at: "2026-08-18T12:30:00.000Z",
						html_url: "https://github.com/acme/widget/pull/8#discussion_r45",
						in_reply_to_id: 44,
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%238?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://github.com/acme/widget/issues/8");
			expect(thread.comments).toEqual([
				{
					id: "44",
					body: "Rename this.",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/pull/8#discussion_r44",
					parentId: null,
					kind: "review",
					children: [
						{
							id: "45",
							body: "Renamed.",
							author: "lev",
							createdAt: "2026-08-18T12:30:00.000Z",
							url: "https://github.com/acme/widget/pull/8#discussion_r45",
							parentId: "44",
							kind: "review",
							children: [],
						},
					],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a ticket panel shows the review threads of its linked PR", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [issue(9, 1)],
			comments: {
				9: [
					{
						id: 90,
						body: "Issue note.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
						html_url: "https://github.com/acme/widget/issues/9#issuecomment-90",
					},
				],
			},
			reviewComments: {
				12: [
					{
						id: 120,
						body: "Rename this.",
						user: { login: "ada" },
						created_at: "2026-08-18T12:10:00.000Z",
						html_url: "https://github.com/acme/widget/pull/12#discussion_r120",
						in_reply_to_id: null,
					},
				],
			},
			graphql: (query) => {
				if (!query.includes("closedByPullRequestsReferences")) {
					return null;
				}
				return json({
					data: {
						repository: {
							issue: {
								closedByPullRequestsReferences: {
									nodes: [
										{
											number: 12,
											repository: { nameWithOwner: "acme/widget" },
										},
									],
								},
							},
						},
					},
				});
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const response = await fetch(
				new URL(
					"/api/threads/github/acme%2Fwidget%239?project=acme%2Fwidget",
					app.base,
				),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments).toEqual([
				{
					id: "90",
					body: "Issue note.",
					author: "ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://github.com/acme/widget/issues/9#issuecomment-90",
					parentId: null,
					kind: "comment",
					children: [],
				},
				{
					id: "120",
					body: "Rename this.",
					author: "ada",
					createdAt: "2026-08-18T12:10:00.000Z",
					url: "https://github.com/acme/widget/pull/12#discussion_r120",
					parentId: null,
					kind: "review",
					children: [],
				},
			]);
			expect(
				sent.some(
					(item) =>
						item.url ===
						"https://api.github.com/repos/acme/widget/pulls/12/comments?per_page=100&page=1",
				),
			).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a nested Linear thread returns the tracker URL", async () => {
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
								body: "Which name?",
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
							{
								id: "comment-child",
								body: "The short name.",
								createdAt: "2026-08-18T12:30:00.000Z",
								parent: { id: "comment-parent" },
								user: { displayName: "Lev" },
							},
						],
					},
				},
			],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(
				new URL("/api/threads/linear/PF-1?project=widget-launch", app.base),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.url).toBe("https://linear.app/issue/PF-1");
			expect(thread.comments).toEqual([
				{
					id: "comment-parent",
					body: "Which name?",
					author: "Ada",
					createdAt: "2026-08-18T12:00:00.000Z",
					url: "https://linear.app/issue/PF-1#comment-parent",
					parentId: null,
					kind: "comment",
					children: [
						{
							id: "comment-child",
							body: "The short name.",
							author: "Lev",
							createdAt: "2026-08-18T12:30:00.000Z",
							url: "https://linear.app/issue/PF-1#comment-child",
							parentId: "comment-parent",
							kind: "comment",
							children: [],
						},
					],
				},
			]);
		} finally {
			await app.stop();
		}
	});

	test("a Linear thread longer than 50 comments keeps the newest comment", async () => {
		const nodes = Array.from({ length: 51 }, (_, index) => ({
			id: `comment-${index}`,
			body: `Comment ${index}`,
			createdAt: `2026-08-18T12:${String(index).padStart(2, "0")}:00.000Z`,
			user: { name: "Ada" },
		}));
		const newest = nodes[50];
		if (newest === undefined) {
			throw new Error("missing newest comment");
		}
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-51",
					identifier: "PF-51",
					title: "Long thread",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: nodes.slice(0, 50),
						pageInfo: { hasNextPage: true, endCursor: "page-2" },
					},
				},
			],
		});
		const pages = new Map([
			[
				null,
				{
					nodes: nodes.slice(0, 50),
					pageInfo: { hasNextPage: true, endCursor: "page-2" },
				},
			],
			[
				"page-2",
				{
					nodes: [newest],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			],
		]);
		const app = await serve(
			async (input, init) => {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("IssueThread")) {
					const after =
						(
							JSON.parse(body) as {
								variables?: { after?: string | null };
							}
						).variables?.after ?? null;
					const page = pages.get(after);
					if (page === undefined) {
						return unrecorded(input);
					}
					return new Response(
						JSON.stringify({
							data: {
								issue: {
									identifier: "PF-51",
									title: "Long thread",
									url: "https://linear.app/issue/PF-51",
									comments: page,
								},
							},
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				return recorded(input, init);
			},
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const response = await fetch(
				new URL("/api/threads/linear/PF-51?project=widget-launch", app.base),
			);
			expect(response.status).toBe(200);
			const thread = (await response.json()) as Thread;
			expect(thread.comments.at(-1)?.id).toBe("comment-50");
			expect(thread.comments).toHaveLength(51);
		} finally {
			await app.stop();
		}
	});

	test("a Linear reply error returns 502 and the tracker message", async () => {
		const recorded = linearFake({
			project: linearProject,
			fail: "reply",
			issues: [
				{
					id: "issue-pf-1",
					identifier: "PF-1",
					title: "Open ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: [] },
				},
			],
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
					body: "Keep this text.",
				}),
			});
			expect(response.status).toBe(502);
			const failed = (await response.json()) as { error: string };
			expect(failed.error).toBe("Linear reply failed: Issue not found");
			expect(failed.error).not.toContain("Keep this text.");
			expect(failed.error).not.toContain("Zod");
		} finally {
			await app.stop();
		}
	});

	test("a plain panel reply quotes an open ask and a reaction acknowledges it", async () => {
		const sent: string[] = [];
		const headline = "Which name should the panel use?";
		const text = "Use the short name.";
		const comments: Record<string, unknown>[] = [
			{
				id: "comment-ask-13",
				body: `${headline}\n\n${ask("pf-13")}`,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
		];
		const issues = [
			{
				id: "issue-pf-13",
				identifier: "PF-13",
				title: "Needs a name",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: { nodes: comments },
			},
			{
				id: "issue-pf-14",
				identifier: "PF-14",
				title: "No open ask",
				description: "Body",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: { nodes: [] },
			},
		];
		const recorded = linearFake({
			project: linearProject,
			issues,
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				pollIntervalSeconds: 3600,
			}),
		);
		try {
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-13",
					body: text,
				}),
			});
			expect(posted.status).toBe(201);
			const created = sent.find((body) => body.includes("commentCreate"));
			expect(created).toBeDefined();
			expect(JSON.parse(created ?? "{}")).toMatchObject({
				variables: {
					input: {
						issueId: "PF-13",
						body: `> ${headline}\n\n${text}`,
					},
				},
			});
			const answered = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(answered.find((item) => item.key === "PF-13")).toMatchObject({
				answered: true,
				acknowledged: false,
			});

			const createdNode = comments.find(
				(comment) => comment.id === "comment-created",
			);
			if (createdNode === undefined) {
				throw new Error("posted reply missing from recorded comments");
			}
			createdNode.reactions = [{ id: "reaction-ack" }];
			const refreshed = await fetch(new URL("/api/refresh", app.base), {
				method: "POST",
			});
			expect(refreshed.status).toBe(204);
			const afterPoll = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(afterPoll.find((item) => item.key === "PF-13")).toMatchObject({
				answered: true,
				acknowledged: true,
			});

			sent.length = 0;
			const plain = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-14",
					body: "  Leave this text.  ",
				}),
			});
			expect(plain.status).toBe(201);
			const unchanged = sent.find((body) => body.includes("commentCreate"));
			expect(JSON.parse(unchanged ?? "{}")).toMatchObject({
				variables: { input: { issueId: "PF-14", body: "Leave this text." } },
			});

			sent.length = 0;
			const blank = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-13",
					body: "   ",
				}),
			});
			expect(blank.status).toBe(400);
			expect(sent.some((body) => body.includes("commentCreate"))).toBe(false);

			const again = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-13",
					body: "Already answered.",
				}),
			});
			expect(again.status).toBe(201);
			const second = sent.find((body) => body.includes("commentCreate"));
			expect(JSON.parse(second ?? "{}")).toMatchObject({
				variables: { input: { body: "Already answered." } },
			});
		} finally {
			await app.stop();
		}
	});

	test("a panel reply quotes a multi-line ask by its headline", async () => {
		const sent: string[] = [];
		const headline = "Which name should the panel use?";
		const askBody = `The panel needs a label.\n${headline}\n\n${ask("pf-20")}`;
		const text = "Use the short name.";
		const comments: Record<string, unknown>[] = [
			{
				id: "comment-ask-20",
				body: askBody,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
		];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-20",
					identifier: "PF-20",
					title: "Needs a label",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: comments },
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				pollIntervalSeconds: 3600,
			}),
		);
		try {
			const before = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(before.find((item) => item.key === "PF-20")).toMatchObject({
				headline,
				answered: false,
			});

			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-20",
					body: text,
				}),
			});
			expect(posted.status).toBe(201);
			const quoted = `> ${headline}\n\n${text}`;
			const created = sent.find((body) => body.includes("commentCreate"));
			expect(JSON.parse(created ?? "{}")).toMatchObject({
				variables: { input: { issueId: "PF-20", body: quoted } },
			});

			comments.push({
				id: "comment-quoted-20",
				body: quoted,
				createdAt: "2026-08-18T13:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			});
			const refreshed = await fetch(new URL("/api/refresh", app.base), {
				method: "POST",
			});
			expect(refreshed.status).toBe(204);
			const answered = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(answered.find((item) => item.key === "PF-20")).toMatchObject({
				headline,
				answered: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a full-line quote of a one-line ask answers it", async () => {
		const askText = "Which name?";
		const comments: Record<string, unknown>[] = [
			{
				id: "comment-ask-full",
				body: `${askText}\n\n${ask("pf-full")}`,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
			{
				id: "comment-quoted-full",
				body: `> Senior, ${askText}\n\nUse the short name.`,
				createdAt: "2026-08-18T13:00:00.000Z",
				user: { name: "Lev" },
				reactions: [],
			},
		];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-full",
					identifier: "PF-FULL",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: comments },
				},
			],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				pollIntervalSeconds: 3600,
			}),
		);
		try {
			const items = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(items.find((item) => item.key === "PF-FULL")).toMatchObject({
				answered: true,
				acknowledged: false,
			});
		} finally {
			await app.stop();
		}
	});

	test("a blank ask, repeated spaces and a partial quote stay unanswered", async () => {
		const sent: string[] = [];
		const headline = "Which name should the panel use?";
		const comments: Record<string, unknown>[] = [
			{
				id: "comment-ask-21",
				body: `   \n\n${ask("pf-21")}`,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
		];
		const spaced: Record<string, unknown>[] = [
			{
				id: "comment-ask-22",
				body: `  ${headline}  \n\n${ask("pf-22")}`,
				createdAt: "2026-08-18T12:00:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
			{
				id: "comment-partial",
				body: "> Which name",
				createdAt: "2026-08-18T12:10:00.000Z",
				user: { name: "Ada" },
				reactions: [],
			},
		];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-21",
					identifier: "PF-21",
					title: "Blank ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: comments },
				},
				{
					id: "issue-pf-22",
					identifier: "PF-22",
					title: "Spaced ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: { nodes: spaced },
				},
			],
			requests: sent,
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				pollIntervalSeconds: 3600,
			}),
		);
		try {
			const open = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(open.find((item) => item.key === "PF-21")).toMatchObject({
				headline: "",
				answered: false,
			});
			expect(open.find((item) => item.key === "PF-22")).toMatchObject({
				headline,
				answered: false,
			});

			const blankAsk = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-21",
					body: "No quote.",
				}),
			});
			expect(blankAsk.status).toBe(201);
			expect(
				JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
			).toMatchObject({
				variables: { input: { issueId: "PF-21", body: "No quote." } },
			});

			sent.length = 0;
			const spacedReply = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-22",
					body: "  Use   the short name.  ",
				}),
			});
			expect(spacedReply.status).toBe(201);
			const quoted = `> ${headline}\n\nUse   the short name.`;
			expect(
				JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
			).toMatchObject({
				variables: { input: { issueId: "PF-22", body: quoted } },
			});
		} finally {
			await app.stop();
		}
	});

	test("a named sentence that spans a line quotes that one line", async () => {
		const sent: string[] = [];
		const line = "Which name should Lev pick?";
		const askBody = `Senior,\n${line}\nThe panel needs a label.\n\n${ask("pf-24")}`;
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-24",
					identifier: "PF-24",
					title: "Needs a label",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-24",
								body: askBody,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
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
			const before = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(before.find((item) => item.key === "PF-24")?.headline).toBe(line);
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-24",
					body: "Use the short name.",
				}),
			});
			expect(posted.status).toBe(201);
			expect(
				JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
			).toMatchObject({
				variables: {
					input: { body: `> ${line}\n\nUse the short name.` },
				},
			});
		} finally {
			await app.stop();
		}
	});

	test("a later workcell report that starts with Reply leaves the ask open", async () => {
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-25",
					identifier: "PF-25",
					title: "Open ask",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-25",
								body: `Which name?\n\n${ask("pf-25")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
								reactions: [],
							},
							{
								id: "comment-report-25",
								body: "Reply recorded.\n\n<!-- workcell:report -->",
								createdAt: "2026-08-18T12:30:00.000Z",
								user: { name: "workcell" },
								reactions: [],
							},
						],
					},
				},
			],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
			}),
		);
		try {
			const items = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(items.find((item) => item.key === "PF-25")).toMatchObject({
				answered: false,
			});
		} finally {
			await app.stop();
		}
	});

	test("a display name still finds the GitHub row and quotes its ask", async () => {
		const sent: Sent[] = [];
		const headline = "This waits on Lev for the signing key.";
		const recorded = githubFetch(sent, {
			issues: [{ ...issue(7), comments: 1 }],
			comments: {
				7: [
					{
						id: 72,
						body: `Senior, ${headline}\n\n${ask("gh-board")}`,
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const listed = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(listed.find((item) => item.key === "acme/widget#7")).toMatchObject(
				{
					project: "acme/widget",
					answered: false,
				},
			);
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "Widget board",
					key: "acme/widget#7",
					body: "Use the short name.",
				}),
			});
			expect(posted.status).toBe(201);
			expect(
				JSON.parse(
					sent.find(
						(item) =>
							item.method === "POST" && item.url.includes("/issues/7/comments"),
					)?.body ?? "{}",
				),
			).toEqual({
				body: `> ${headline}\n\nUse the short name.`,
			});
			const needs = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(needs.find((item) => item.key === "acme/widget#7")).toMatchObject({
				answered: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a GitHub project with a PM Bot posts an unnamed ask unchanged", async () => {
		const sent: Sent[] = [];
		const recorded = githubFetch(sent, {
			issues: [
				{
					...issue(7),
					comments: 1,
				},
			],
			comments: {
				7: [
					{
						id: 71,
						body: `Which name?\n\n${ask("gh-7")}`,
						user: { login: "ada" },
						created_at: "2026-08-18T12:00:00.000Z",
					},
				],
			},
		});
		const app = await serve(
			recorded,
			JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		try {
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
					body: "Use the short name.",
				}),
			});
			expect(posted.status).toBe(201);
			const created = sent.find(
				(item) =>
					item.method === "POST" && item.url.includes("/issues/7/comments"),
			);
			expect(JSON.parse(created?.body ?? "{}")).toEqual({
				body: "Use the short name.",
			});
		} finally {
			await app.stop();
		}
	});

	test("a reply under another comment posts the typed text and leaves the ask open", async () => {
		const sent: string[] = [];
		const headline = "Which name?";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-26",
					identifier: "PF-26",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-26",
								body: `${headline}\n\n${ask("pf-26")}`,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
							{
								id: "comment-other-26",
								body: "A note beside the ask.",
								createdAt: "2026-08-18T12:05:00.000Z",
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
			const nested = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-26",
					parentId: "comment-other-26",
					body: "Use the short name.",
				}),
			});
			expect(nested.status).toBe(201);
			expect(
				JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
			).toMatchObject({
				variables: {
					input: {
						issueId: "PF-26",
						parentId: "comment-other-26",
						body: "Use the short name.",
					},
				},
			});
			const open = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(open.find((item) => item.key === "PF-26")).toMatchObject({
				headline,
				answered: false,
			});

			sent.length = 0;
			const underAsk = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-26",
					parentId: "comment-ask-26",
					body: "Use the short name.",
				}),
			});
			expect(underAsk.status).toBe(201);
			const quoted = `> ${headline}\n\nUse the short name.`;
			expect(
				JSON.parse(sent.find((body) => body.includes("commentCreate")) ?? "{}"),
			).toMatchObject({
				variables: {
					input: {
						parentId: "comment-ask-26",
						body: quoted,
					},
				},
			});
			const answered = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(answered.find((item) => item.key === "PF-26")).toMatchObject({
				headline,
				answered: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a marker-only ask posts the panel text unchanged", async () => {
		const sent: string[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-15",
					identifier: "PF-15",
					title: "Marker only",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-15",
								body: ask("pf-15"),
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
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
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-15",
					body: "No headline to quote.",
				}),
			});
			expect(posted.status).toBe(201);
			const created = sent.find((body) => body.includes("commentCreate"));
			expect(JSON.parse(created ?? "{}")).toMatchObject({
				variables: { input: { body: "No headline to quote." } },
			});
		} finally {
			await app.stop();
		}
	});

	test("a reply that quotes the old headline stays answered", async () => {
		const named = "This waits on Lev for the signing key.";
		const question = "Which key should the panel use?";
		const askBody = `Senior, ${named}\n${question}\n\n1. the current key\n2. a new key\n\n${ask("pf-40")}`;
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-40",
					identifier: "PF-40",
					title: "Needs a key",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-40",
								body: askBody,
								createdAt: "2026-08-18T12:00:00.000Z",
								user: { name: "Ada" },
							},
							{
								id: "comment-quoted-40",
								body: `> ${named}\n\nUse the current key.`,
								createdAt: "2026-08-18T13:00:00.000Z",
								user: { name: "Lev" },
							},
						],
					},
				},
			],
		});
		const app = await serve(
			recorded,
			JSON.stringify({
				pinned: [{ tracker: "linear", project: "widget-launch" }],
				pmBot: { "widget-launch": false },
			}),
		);
		try {
			const listed = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(listed.find((item) => item.key === "PF-40")).toMatchObject({
				headline: named,
				question,
				answered: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("picking an option posts a reply that names the pick", async () => {
		const sent: string[] = [];
		const question = "Which name should the gate use?";
		const pick = "the short name";
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-30",
					identifier: "PF-30",
					title: "Needs a name",
					description: "Body",
					state: { type: "unstarted" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [] },
					comments: {
						nodes: [
							{
								id: "comment-ask-30",
								body: `${question}\n\n1. ${pick}\n2. the long name\n\n${ask("pf-30")}`,
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
				pmBot: { "widget-launch": false },
			}),
		);
		try {
			const before = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(before.find((item) => item.key === "PF-30")).toMatchObject({
				question,
				options: [
					{ number: 1, label: pick },
					{ number: 2, label: "the long name" },
				],
				answered: false,
			});
			const posted = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "linear",
					project: "widget-launch",
					key: "PF-30",
					option: 1,
				}),
			});
			expect(posted.status).toBe(201);
			const created = sent.find((body) => body.includes("commentCreate"));
			const input = (
				JSON.parse(created ?? "{}") as {
					variables?: { input?: { body?: string } };
				}
			).variables?.input?.body;
			expect(input).toContain("1. the short name");
			const after = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(after.find((item) => item.key === "PF-30")).toMatchObject({
				answered: true,
			});
		} finally {
			await app.stop();
		}
	});

	test("a disabled merge or label action sends no tracker request", async () => {
		const trackerHosts = ["api.linear.app", "api.github.com"];
		const writes = ["POST", "PUT", "PATCH", "DELETE"];
		const calls: { method: string; host: string }[] = [];
		const recorded = linearFake({
			project: linearProject,
			issues: [
				{
					id: "issue-pf-31",
					identifier: "PF-31",
					title: "Ready",
					description: "Body",
					state: { type: "started" },
					updatedAt: "2026-08-18T12:00:00.000Z",
					labels: { nodes: [{ name: "needs-human" }] },
					assignee: { id: "viewer-ada", name: "Ada" },
					comments: { nodes: [] },
				},
			],
		});
		const app = await serve(async (input, init) => {
			const method =
				init?.method ?? (input instanceof Request ? input.method : "GET");
			calls.push({ method, host: new URL(urlOf(input)).host });
			return recorded(input, init);
		}, JSON.stringify({
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			needsYouLabels: ["needs-human"],
		}));
		try {
			const listed = (await (
				await fetch(new URL("/api/needs-you", app.base))
			).json()) as NeedsYouItem[];
			expect(listed.find((item) => item.key === "PF-31")).toMatchObject({
				reason: "label",
			});
			const before = calls.length;
			for (const action of ["merge", "remove-label"]) {
				await fetch(new URL("/api/replies", app.base), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						tracker: "linear",
						project: "widget-launch",
						key: "PF-31",
						action,
					}),
				});
			}
			const write = calls.slice(before).find(
				(call) =>
					writes.includes(call.method) && trackerHosts.includes(call.host),
			);
			expect(write).toBeUndefined();
		} finally {
			await app.stop();
		}
	});
});
