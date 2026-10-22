import { expect, test } from "bun:test";
import type { NeedsYouItem, PollProgress } from "../src/domain.ts";
import { eventsOf } from "./events.ts";
import { serve } from "./replies-github-fake.ts";
import { linearFake } from "./support.ts";

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

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
		}): PollProgress | null => {
			if (event.event !== "progress") {
				return null;
			}
			return JSON.parse(event.data) as PollProgress;
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
