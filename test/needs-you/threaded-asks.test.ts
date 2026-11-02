import { describe, expect, test } from "bun:test";

import type { TrackerRequest } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";
import {
	ask,
	githubRecorded,
	linearIssue,
	linearProject,
	openPull,
	readNeedsYou,
} from "./_support.ts";

const linearConfig = {
	pinned: [{ tracker: "linear", project: "project-flow" }],
};
const linearEnv = { env: { LINEAR_API_KEY: "recorded-linear-key" } };
const agent = { id: "agent", name: "AbysmalBiscuit" };
const lev = { id: "lev", name: "Lev" };
const question = "Lev, which name should the column take?";
const askBody = `${question}\n\n1. A: the short name\n2. B: the long name\n\n${ask("pf-30")}`;
const answeredBy =
	"Answered by Lev on the [Linear thread](https://linear.app/issue/PF-30#comment-ask)";

describe("needs you", () => {
	test("an ask that Lev answered in its Linear thread and the factory recorded leaves Needs you", async () => {
		const sent: TrackerRequest[] = [];
		const { items, needsYou } = await readNeedsYou(
			linearFake({
				project: linearProject,
				sent,
				issues: [
					linearIssue("PF-30", "Name the column", "Pick a name.", [
						{
							id: "comment-ask",
							createdAt: "2026-11-01T10:00:00.000Z",
							body: `${askBody}\n\n${answeredBy}`,
							user: agent,
						},
						{
							id: "comment-reply",
							createdAt: "2026-11-01T11:00:00.000Z",
							body: "Go with A, the short name reads better on the board.",
							user: lev,
							parent: { id: "comment-ask" },
						},
						{
							id: "comment-decisions",
							createdAt: "2026-11-01T11:05:00.000Z",
							body: "**Decisions**\n- Name the column: A, the short name.\n\n<!-- workcell:decisions -->",
							user: agent,
						},
					]),
				],
			}),
			linearConfig,
			linearEnv,
		);
		expect(
			items.filter((item) => item.key === "PF-30" && item.reason === "ask"),
		).toEqual([]);
		expect(needsYou).toBe(0);
		const issueRead = sent.find((request) =>
			request.query.includes("ProjectIssues"),
		);
		expect(issueRead?.query).toMatch(
			/comments\([^)]*\)\s*\{\s*nodes\s*\{[^}]*parent\s*\{\s*id\s*\}/,
		);
	});

	test("a threaded Linear reply answers the ask before the factory edits it", async () => {
		const { items } = await readNeedsYou(
			linearFake({
				project: linearProject,
				issues: [
					linearIssue("PF-31", "Name the column", "Pick a name.", [
						{
							id: "comment-ask",
							createdAt: "2026-11-01T10:00:00.000Z",
							body: askBody.replace("pf-30", "pf-31"),
							user: agent,
						},
						{
							id: "comment-reply",
							createdAt: "2026-11-01T11:00:00.000Z",
							body: "Go with A.",
							user: lev,
							parent: { id: "comment-ask" },
						},
					]),
				],
			}),
			linearConfig,
			linearEnv,
		);
		expect(items.filter((item) => item.key === "PF-31")).toMatchObject([
			{ reason: "ask", answered: true },
		]);
	});

	test("a top-level comment from Lev with no prefix, quote or thread link leaves the ask open", async () => {
		const { items, needsYou } = await readNeedsYou(
			linearFake({
				project: linearProject,
				issues: [
					linearIssue("PF-32", "Name the column", "Pick a name.", [
						{
							id: "comment-ask",
							createdAt: "2026-11-01T10:00:00.000Z",
							body: askBody.replace("pf-30", "pf-32"),
							user: agent,
						},
						{
							id: "comment-note",
							createdAt: "2026-11-01T11:00:00.000Z",
							body: "Go with A.",
							user: lev,
							parent: null,
						},
					]),
				],
			}),
			linearConfig,
			linearEnv,
		);
		expect(items.filter((item) => item.key === "PF-32")).toMatchObject([
			{ reason: "ask", answered: false, headline: question },
		]);
		expect(needsYou).toBe(1);
	});

	test("an ask with an Answered by line leaves Needs you on a GitHub PR", async () => {
		const repo = "acme/widget";
		const { items, needsYou } = await readNeedsYou(
			githubRecorded(repo, {
				pulls: [openPull(repo, 50, "Name the column", "A fix with no ticket.")],
				comments: {
					50: [
						{
							body: `${askBody.replace("pf-30", "pr-50")}\n\nAnswered by Lev on the tracker issue`,
							created_at: "2026-11-01T10:00:00Z",
							user: { login: "agent" },
						},
					],
				},
			}),
			{ pinned: [{ tracker: "github", repo }], pmBot: { [repo]: false } },
		);
		expect(items).toMatchObject([
			{ reason: "awaitingMerge", headline: "Name the column" },
		]);
		expect(needsYou).toBe(1);
	});
});
