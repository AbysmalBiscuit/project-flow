import { describe, expect, test } from "bun:test";

import issue51Comments from "../fixtures/issue-51-comments.json";
import { overview } from "../review-github-fake.ts";
import { head, pull, repo } from "../support/github.ts";
import { card, grok, issue, mergedPull, older, progress } from "./_support.ts";

describe("review cycle", () => {
	test("a progress entry after the final report puts the PR back in review", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (progressComment === undefined || report === undefined) {
			throw new Error("issue 51 comments were not recorded");
		}
		const body = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: issue51Comments },
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
		expect(body).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("an answered final-report ask puts the PR back in review and an open one keeps it awaiting merge", async () => {
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
		const ask = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1:"),
		);
		const answeredAt = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1 answered:"),
		);
		if (ask < 0 || answeredAt < 0) {
			throw new Error("issue 51 progress has no ask-1 entry");
		}
		const openProgress = {
			...progressComment,
			body: lines.slice(0, ask + 1).join("\n"),
		};
		const answeredProgress = {
			...progressComment,
			body: lines.slice(0, answeredAt + 1).join("\n"),
		};
		const open = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
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
		expect(open).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
		);
		const answered = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [answeredProgress, report] },
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
		expect(answered).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("a second final report with an open ask keeps the PR awaiting merge", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (
			progressComment === undefined ||
			report === undefined ||
			typeof progressComment.body !== "string" ||
			typeof report.body !== "string"
		) {
			throw new Error("issue 51 comments were not recorded");
		}
		const lines = progressComment.body.split("\n");
		const askLine = lines.find((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1:"),
		);
		const answeredAt = lines.findIndex((line) =>
			line.trim().replace(/^-\s*/, "").startsWith("ask-1 answered:"),
		);
		if (askLine === undefined || answeredAt < 0) {
			throw new Error("issue 51 progress has no ask-1 entry");
		}
		const resumed = {
			...progressComment,
			body: [
				...lines.slice(0, answeredAt + 1),
				"- stage 1: implementing the second report",
				"- stage 5: round 2 of 2",
				askLine.replace("ask-1:", "ask-2:"),
			].join("\n"),
		};
		const second = report.body.replaceAll("51-1", "51-2");
		const body = await overview({
			issues: [{ ...issue(51), comments: 3 }],
			pulls: [pull(52, 51)],
			commentsByIssue: {
				51: [resumed, report, { ...report, id: 6260874284, body: second }],
			},
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
		expect(body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
		);
	});

	test("a later stage line puts the PR back in review while the final-report ask stays open", async () => {
		const progressComment = issue51Comments[0];
		const report = issue51Comments[1];
		if (
			progressComment === undefined ||
			report === undefined ||
			typeof progressComment.body !== "string"
		) {
			throw new Error("issue 51 comments were not recorded");
		}
		const openProgress = {
			...progressComment,
			body: progressComment.body
				.split("\n")
				.filter((line) => !line.includes("ask-1 answered:"))
				.join("\n"),
		};
		const resumed = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
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
		expect(resumed).toEqual(
			card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				0,
				`${repo}#51`,
				"Ticket 51",
			),
		);
		const noPmBot = await overview({
			issues: [{ ...issue(51), comments: issue51Comments.length }],
			pulls: [pull(52, 51)],
			commentsByIssue: { 51: [openProgress, report] },
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
		expect(noPmBot).toEqual({
			body: card(
				"inReview",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 1,
					awaitingMerge: 0,
				},
				[],
				1,
				`${repo}#51`,
				"Ticket 51",
			),
			needsYou: [
				expect.objectContaining({
					project: repo,
					tracker: "github",
					key: `${repo}#51`,
					headline: expect.any(String),
					reason: "ask",
					tags: [],
					answered: false,
					acknowledged: false,
				}),
			],
		});
	});

	test("a final report on one open PR leaves the other open PR in review", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/84\n- final report sent https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank report marker and repeated spaces still follow the final-report ask", async () => {
		const blank = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{ body: "   \n\n<!-- workcell:report -->" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(blank).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		const spaced = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage   5: round 1 of 3\n- ask-1:   final   report for https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(spaced).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a marked report follows its ask and a marked report with no ask stays awaiting merge", async () => {
		const marked = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(marked).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		const answered = await overview({
			issues: [{ ...issue(8), comments: 3 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
					{ body: "answer: ship it" },
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(answered).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
		const open = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2 https://github.com/acme/widget/pull/83",
						),
					},
					{
						body: "Round notes.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(open).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report that is also the ask is awaiting merge while the PR is open", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n**PR:** https://github.com/acme/widget/pull/83\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
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
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report that names no PR is awaiting merge for every open PR", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.\n- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.",
						),
					},
					{
						body: "Final report for   \n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
	});

	test("a final report for one PR leaves the other open PR in review", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.\n- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.",
						),
					},
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
				[second]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
				84: [{ user: { login: grok }, commit_id: second, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a final report posted before the progress comment leaves the run at its stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: "Final report for https://github.com/acme/widget/pull/83. 1 row left.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 8-1 -->",
					},
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
						),
					},
				],
			},
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		});
		expect(body).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});
});
