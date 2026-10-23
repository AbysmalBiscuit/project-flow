import { describe, expect, test } from "bun:test";
import { z } from "zod";
import issue51Comments from "./fixtures/issue-51-comments.json";
import {
	card,
	grok,
	head,
	issue,
	mergedPull,
	older,
	overview,
	pull,
	repo,
} from "./review-support.ts";

describe("the Ask rule", () => {
	const progressComment = issue51Comments[0];
	const report = issue51Comments[1];
	if (
		progressComment === undefined ||
		report === undefined ||
		typeof progressComment.body !== "string"
	) {
		throw new Error("issue 51 comments were not recorded");
	}
	const lines = progressComment.body.split("\n");
	const answeredAt = lines.findIndex((line) =>
		line.trim().replace(/^-\s*/, "").startsWith("ask-1 answered:"),
	);
	const openProgress = {
		...progressComment,
		body: lines.slice(0, answeredAt).join("\n"),
	};
	const answeredProgress = {
		...progressComment,
		body: lines.slice(0, answeredAt + 1).join("\n"),
	};
	const views = (comments: Record<string, unknown>[]) =>
		overview({
			issues: [{ ...issue(51), comments: comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: comments },
			withNeedsYou: true,
			config: JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pmBot: { [repo]: false },
			}),
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
	const inReview = (needsYou: number) =>
		card(
			"inReview",
			{ backlog: 0, inProgress: 0, inReview: 1, awaitingMerge: 0 },
			[],
			needsYou,
			`${repo}#51`,
			"Ticket 51",
		);

	const reply = (body: string) => ({
		id: 6260874290,
		body,
		created_at: "2026-10-19T06:12:00Z",
		user: { login: "AbysmalBiscuit" },
	});
	const answered = {
		body: inReview(1),
		needsYou: [
			expect.objectContaining({
				key: `${repo}#51`,
				reason: "ask",
				answered: true,
			}),
		],
	};

	test("an answer reply clears the ask in Awaiting merge and in Needs you", async () => {
		const open = await views([openProgress, report]);
		expect(open).toEqual({
			body: card(
				"awaitingMerge",
				{ backlog: 0, inProgress: 0, inReview: 0, awaitingMerge: 1 },
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
			needsYou: [
				expect.objectContaining({
					key: `${repo}#51`,
					reason: "ask",
					answered: false,
				}),
			],
		});
		const headline = z
			.object({ needsYou: z.array(z.object({ headline: z.string() })) })
			.parse(open).needsYou[0]?.headline;
		expect(
			await views([openProgress, report, reply("answer: hold PR 52.")]),
		).toEqual(answered);
		expect(
			await views([
				openProgress,
				report,
				reply(`> ${headline}\n\nanswer: hold PR 52.`),
			]),
		).toEqual(answered);
	});

	test("an ask-N answered progress line clears the ask in Awaiting merge and in Needs you", async () => {
		expect(await views([answeredProgress, report])).toEqual({
			body: inReview(0),
			needsYou: [],
		});
	});
});
