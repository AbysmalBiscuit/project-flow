import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeedsYouItem } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { eventsOf } from "./events.ts";
import {
	linearFake,
	recordedDiscovery,
	repoReadFromLists,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

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
		const comments = url.match(
			/\/repos\/acme\/widget\/issues\/(\d+)\/comments(?:\?([^#]*))?$/,
		);
		if (comments !== null && method === "GET") {
			const number = Number(comments[1]);
			return json(options.comments?.[number] ?? []);
		}
		if (comments !== null && method === "POST") {
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
		if (url === "https://api.github.com/graphql" && method === "POST") {
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
		return unrecorded(input);
	};
}
const linearProject = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Widget launch",
	slugId: "widget-launch",
};

// Wait for a progress start after the stream opens, then that poll's end.
// A replayed or in-flight poll's ended event is not this refresh.
async function refreshSettled(base: string): Promise<void> {
	const stream = await fetch(new URL("/api/events", base), {
		headers: { accept: "text/event-stream" },
	});
	const reader = stream.body?.getReader();
	if (reader === undefined) {
		throw new Error("event stream has no body");
	}
	const decoder = new TextDecoder();
	let buffered = "";
	try {
		const opened = await reader.read();
		buffered += decoder.decode(opened.value, { stream: true });
		if (!buffered.includes(": open")) {
			throw new Error("event stream did not open");
		}
		const openEvents = eventsOf(buffered);
		const refreshed = await fetch(new URL("/api/refresh", base), {
			method: "POST",
		});
		if (refreshed.status !== 204) {
			throw new Error(`refresh returned ${refreshed.status}`);
		}
		const progressOf = (event: {
			event: string;
			data: string;
		}): { done?: number; ended?: boolean } | null => {
			if (event.event !== "progress") {
				return null;
			}
			return JSON.parse(event.data) as { done?: number; ended?: boolean };
		};
		const ownPollSettled = (text: string): boolean => {
			const progress = eventsOf(text)
				.slice(openEvents.length)
				.map(progressOf)
				.filter((item) => item !== null);
			const started = progress.findIndex(
				(item) => item.done === 0 && item.ended === false,
			);
			return (
				started >= 0 &&
				progress.slice(started).some((item) => item.ended === true)
			);
		};
		while (!ownPollSettled(buffered)) {
			const chunk = await reader.read();
			if (chunk.done) {
				throw new Error("event stream closed before the poll ended");
			}
			buffered += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		await reader.cancel();
	}
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
		await refreshSettled(app.base);
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
		expect(listed.find((item) => item.key === "acme/widget#7")).toMatchObject({
			project: "acme/widget",
			answered: false,
		});
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
