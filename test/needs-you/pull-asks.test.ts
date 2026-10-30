import { describe, expect, test } from "bun:test";

import {
	ask,
	githubRecorded,
	openIssue,
	openPull,
	readNeedsYou,
} from "./_support.ts";

const repo = "acme/widget";

describe("needs you", () => {
	test("lists an open ask addressed to Lev on a PR", async () => {
		const question = "This waits on Lev for the signing key.";
		const { items, needsYou } = await readNeedsYou(
			githubRecorded(repo, {
				pulls: [
					openPull(repo, 49, "Count PR asks", "A fix with no ticket.", {
						ref: "49-feat-pr-ask",
					}),
				],
				comments: {
					49: [
						{
							body: `${question}\n\n${ask("pr-49")}`,
							created_at: "2026-10-01T00:00:00Z",
							user: { login: "agent" },
						},
					],
				},
			}),
			{ pinned: [{ tracker: "github", repo }] },
		);
		expect(needsYou).toBe(1);
		expect(items.map((item) => item.key)).toEqual([`${repo}#49`]);
		expect(items[0]).toMatchObject({
			headline: question,
			reason: "ask",
			answered: false,
			tags: ["matched by name"],
		});
	});

	test("lists an unlinked PR that is awaiting merge", async () => {
		const { items, needsYou } = await readNeedsYou(
			githubRecorded(repo, {
				pulls: [
					openPull(repo, 90, "A fix with no ticket", "A fix with no ticket."),
					openPull(repo, 91, "Draft fix", "   ", { draft: true }),
				],
			}),
			{ pinned: [{ tracker: "github", repo }] },
		);
		expect(items.map((item) => item.key)).toEqual([`${repo}#90`]);
		expect(needsYou).toBe(1);
		expect(items[0]).toMatchObject({
			headline: "A fix with no ticket",
			reason: "awaitingMerge",
			answered: false,
			tags: [],
		});
	});

	test("omits a senior-only PR ask and keeps an answered PR ask", async () => {
		const question = "Which bot should review this?";
		const { items } = await readNeedsYou(
			githubRecorded(repo, {
				pulls: [
					openPull(repo, 92, "Senior ask", "A fix with no ticket."),
					openPull(repo, 93, "Answered ask", "A fix with no ticket."),
				],
				comments: {
					92: [
						{
							body: `Senior, ${question}\n\n${ask("pr-92")}`,
							created_at: "2026-10-01T00:00:00Z",
							user: { login: "agent" },
						},
					],
					93: [
						{
							body: `Senior, this waits on Lev for the signing key.\n\n${ask("pr-93")}`,
							created_at: "2026-10-01T00:00:00Z",
							user: { login: "agent" },
						},
						{
							body: "Reply: noted.",
							created_at: "2026-10-01T01:00:00Z",
							user: { login: "lev" },
							reactions: { total_count: 1 },
						},
					],
				},
			}),
			{
				pinned: [{ tracker: "github", repo }],
				expectedBots: { [repo]: ["grok"] },
				pmBot: { [repo]: true },
			},
		);
		expect(items.map((item) => item.key)).toEqual([`${repo}#93`]);
		expect(items.find((item) => item.key === `${repo}#93`)).toMatchObject({
			reason: "ask",
			answered: true,
			acknowledged: true,
			tags: ["matched by name"],
		});
	});

	test("folds a linked PR ask into its ticket item", async () => {
		const headline = "This waits on Lev for the signing key.";
		const { items } = await readNeedsYou(
			githubRecorded(repo, {
				issues: [openIssue(8, "Ship the signing key")],
				pulls: [
					openPull(repo, 49, "Count PR asks", "Closes #8", {
						ref: "49-feat-pr-ask",
					}),
				],
				comments: {
					49: [
						{
							body: `${headline}\n\n${ask("pr-49")}`,
							created_at: "2026-10-01T00:00:00Z",
							user: { login: "agent" },
						},
					],
				},
			}),
			{ pinned: [{ tracker: "github", repo }] },
		);
		expect(items.map((item) => item.key)).toEqual([`${repo}#8`]);
		expect(items[0]).toMatchObject({
			tracker: "github",
			headline,
			reason: "ask",
			answered: false,
			tags: ["matched by name"],
		});
	});
});
