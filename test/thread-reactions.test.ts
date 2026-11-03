import { expect, test } from "bun:test";

import type { NeedsYouItem, Thread } from "../src/domain.ts";
import {
	githubFetch,
	issue,
	json,
	type Sent,
	serve,
} from "./replies-github-fake.ts";
import { linearFake } from "./support/linear.ts";
import { settledRead } from "./support/reads.ts";

const noReactions = {
	url: "https://api.github.com/repos/acme/widget/issues/comments/90/reactions",
	total_count: 0,
	"+1": 0,
	"-1": 0,
	laugh: 0,
	hooray: 0,
	confused: 0,
	heart: 0,
	rocket: 0,
	eyes: 0,
};

const reactionsOf = (thread: Thread) =>
	Object.fromEntries(
		thread.comments.map((comment) => [comment.id, comment.reactions]),
	);

test("a GitHub thread returns the reactions of comments, review comments and reviews", async () => {
	const sent: Sent[] = [];
	const recorded = githubFetch(sent, {
		issues: [issue(9, 2)],
		comments: {
			9: [
				{
					id: 90,
					body: "Which name?",
					user: { login: "ada" },
					created_at: "2026-08-18T12:00:00.000Z",
					html_url: "https://github.com/acme/widget/issues/9#issuecomment-90",
					reactions: { ...noReactions, total_count: 3, "+1": 2, eyes: 1 },
				},
				{
					id: 91,
					body: "The short name.",
					user: { login: "lev" },
					created_at: "2026-08-18T12:01:00.000Z",
					html_url: "https://github.com/acme/widget/issues/9#issuecomment-91",
					reactions: noReactions,
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
					reactions: { ...noReactions, total_count: 1, heart: 1 },
				},
			],
		},
		reviews: {
			12: [
				{
					id: 130,
					node_id: "PRR_kwDOreview130",
					body: "Split the parser out.",
					state: "CHANGES_REQUESTED",
					user: { login: "lev" },
					submitted_at: "2026-08-18T12:05:00Z",
					html_url:
						"https://github.com/acme/widget/pull/12#pullrequestreview-130",
				},
			],
		},
		graphql: (query) => {
			if (query.includes("closedByPullRequestsReferences")) {
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
			}
			if (query.includes("ReviewReactions")) {
				return json({
					data: {
						nodes: [
							{
								id: "PRR_kwDOreview130",
								reactionGroups: [
									{ content: "THUMBS_UP", reactors: { totalCount: 1 } },
									{ content: "THUMBS_DOWN", reactors: { totalCount: 0 } },
									{ content: "ROCKET", reactors: { totalCount: 2 } },
								],
							},
						],
					},
				});
			}
			return null;
		},
	});
	const app = await serve(
		recorded,
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	try {
		const response = await settledRead(
			new URL(
				"/api/threads/github/acme%2Fwidget%239?project=acme%2Fwidget",
				app.base,
			),
		);
		expect(response.status).toBe(200);
		const thread = (await response.json()) as Thread;
		expect(reactionsOf(thread)).toEqual({
			"90": [
				{ emoji: "👍", count: 2 },
				{ emoji: "👀", count: 1 },
			],
			"91": [],
			"review-130": [
				{ emoji: "👍", count: 1 },
				{ emoji: "🚀", count: 2 },
			],
			"120": [{ emoji: "❤️", count: 1 }],
		});
		const reviewRead = sent.find((item) =>
			item.body.includes("ReviewReactions"),
		);
		expect(
			(JSON.parse(reviewRead?.body ?? "{}") as { variables?: unknown })
				.variables,
		).toEqual({ ids: ["PRR_kwDOreview130"] });
	} finally {
		await app.stop();
	}
});

test("a Linear thread returns the reactions of each comment by emoji", async () => {
	const requests: string[] = [];
	const recorded = linearFake({
		project: {
			id: "11111111-1111-4111-8111-111111111111",
			name: "Widget launch",
			slugId: "widget-launch",
		},
		requests,
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
							id: "comment-ask",
							body: "Which name?",
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Adaptyv Software Factory" },
							reactions: [],
						},
						{
							id: "comment-answer",
							body: "The short name.",
							createdAt: "2026-08-18T12:30:00.000Z",
							user: { name: "Lev" },
							reactions: [
								{ id: "8f5eddda-34d2-423b-ae60-7022b30207bc", emoji: "+1" },
								{ id: "34f76961-1690-4890-baf4-b61716cf336b", emoji: "eyes" },
								{ id: "02e61a7c-9598-4de2-8a3c-a78925c596d5", emoji: "+1" },
								{ id: "1c1d3b0e-6a0e-4c43-9c5b-0d1e2f3a4b5c", emoji: "pog" },
							],
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
		const response = await settledRead(
			new URL("/api/threads/linear/PF-1?project=widget-launch", app.base),
		);
		expect(response.status).toBe(200);
		const thread = (await response.json()) as Thread;
		expect(reactionsOf(thread)).toEqual({
			"comment-ask": [],
			"comment-answer": [
				{ emoji: "👍", count: 2 },
				{ emoji: "👀", count: 1 },
				{ emoji: ":pog:", count: 1 },
			],
		});
		expect(requests.find((body) => body.includes("IssueThread"))).toContain(
			"reactions { emoji }",
		);
	} finally {
		await app.stop();
	}
});

const ask = (id: string) => `<!-- workcell:ask ${id} -->`;

const settledNeedsYou = async (base: string, key: string) => {
	const response = await settledRead(new URL("/api/needs-you", base));
	const items = (await response.json()) as NeedsYouItem[];
	return items.find((item) => item.key === key);
};

test("a Linear reaction that acknowledges a reply is the pill under it", async () => {
	const requests: string[] = [];
	const recorded = linearFake({
		project: {
			id: "11111111-1111-4111-8111-111111111111",
			name: "Widget launch",
			slugId: "widget-launch",
		},
		requests,
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
							body: `Which name?\n\n${ask("pf-9")}`,
							createdAt: "2026-08-18T12:00:00.000Z",
							user: { name: "Adaptyv Software Factory" },
							reactions: [],
						},
						{
							id: "comment-reply",
							body: "Reply: the short name.",
							createdAt: "2026-08-18T12:30:00.000Z",
							user: { name: "Lev" },
							reactions: [
								{ id: "8f5eddda-34d2-423b-ae60-7022b30207bc", emoji: "+1" },
							],
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
		expect(await settledNeedsYou(app.base, "PF-9")).toMatchObject({
			answered: true,
			acknowledged: true,
		});
		const response = await settledRead(
			new URL("/api/threads/linear/PF-9?project=widget-launch", app.base),
		);
		const thread = (await response.json()) as Thread;
		expect(reactionsOf(thread)).toEqual({
			"comment-ask": [],
			"comment-reply": [{ emoji: "👍", count: 1 }],
		});
		const poll = requests.find((body) => body.includes("ProjectIssues"));
		expect(poll).toContain("reactions { emoji }");
	} finally {
		await app.stop();
	}
});

test("a GitHub reaction that acknowledges a reply is the pill under it", async () => {
	const sent: Sent[] = [];
	const recorded = githubFetch(sent, {
		issues: [issue(7, 2)],
		comments: {
			7: [
				{
					id: 70,
					body: `This waits on Lev: which name?\n\n${ask("gh-7")}`,
					user: { login: "workcell-bot" },
					created_at: "2026-08-18T12:00:00.000Z",
					html_url: "https://github.com/acme/widget/issues/7#issuecomment-70",
					reactions: noReactions,
				},
				{
					id: 71,
					body: "Reply: the short name.",
					user: { login: "lev" },
					created_at: "2026-08-18T12:30:00.000Z",
					html_url: "https://github.com/acme/widget/issues/7#issuecomment-71",
					reactions: { ...noReactions, total_count: 1, eyes: 1 },
				},
			],
		},
	});
	const app = await serve(
		recorded,
		JSON.stringify({
			pinned: [{ tracker: "github", repo: "acme/widget" }],
			pmBot: { "acme/widget": false },
		}),
	);
	try {
		expect(await settledNeedsYou(app.base, "acme/widget#7")).toMatchObject({
			answered: true,
			acknowledged: true,
		});
		const response = await settledRead(
			new URL(
				"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
				app.base,
			),
		);
		const thread = (await response.json()) as Thread;
		expect(reactionsOf(thread)).toEqual({
			"70": [],
			"71": [{ emoji: "👀", count: 1 }],
		});
		expect(
			sent.some(
				(item) =>
					item.body.includes("databaseId body") &&
					item.body.includes(
						"reactionGroups { content reactors { totalCount } }",
					),
			),
		).toBe(true);
	} finally {
		await app.stop();
	}
});
