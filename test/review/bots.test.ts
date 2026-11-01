import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { githubFetch, overview } from "../review-github-fake.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { codex, head, pull, repo } from "../support/github.ts";
import { card, greptile, grok, issue, mergedPull, older } from "./_support.ts";

describe("review cycle", () => {
	test("an open PR with a changes-requested review is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(83)],
			reviewsByPull: {
				83: [
					{
						user: { login: codex },
						commit_id: older,
						state: "CHANGES_REQUESTED",
					},
				],
			},
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				83: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
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

	test("a running Grok check on the head commit stays in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(84)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
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

	test("a Grok review on the head past the first page is awaiting merge", async () => {
		const filler = Array.from({ length: 100 }, () => ({
			user: { login: "someone" },
			commit_id: older,
			state: "COMMENTED",
		}));
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(97)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				97: [
					...filler,
					{ user: { login: grok }, commit_id: head, state: "COMMENTED" },
				],
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

	test("a finished Grok review on the head commit is awaiting merge", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(85)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				85: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { body: unknown; needsYou: NeedsYouItem[] };
		expect(listed.body).toEqual(
			card("awaitingMerge", {
				backlog: 0,
				inProgress: 0,
				inReview: 0,
				awaitingMerge: 1,
			}),
		);
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			review: "completed",
		});
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull?.review,
		).not.toBe("approved");
	});

	test("a later approval from the same reviewer supersedes changes requested", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(92)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "ci",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			reviewsByPull: {
				92: [
					{
						user: { login: "ada" },
						commit_id: head,
						state: "CHANGES_REQUESTED",
					},
					{
						user: { login: "ada" },
						commit_id: head,
						state: "APPROVED",
					},
				],
			},
		})) as { needsYou: NeedsYouItem[] };
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			review: "approved",
		});
	});

	test("a Grok usage-limit comment counts only when it is newer than the head commit", async () => {
		const olderLimit = await overview({
			issues: [issue(8)],
			pulls: [pull(90)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			commentsByPull: {
				90: [
					{
						user: { login: grok },
						body: "You have reached your Grok usage limit for code reviews.",
						created_at: "2026-10-17T12:00:00Z",
					},
				],
			},
			commitsBySha: {
				[head]: {
					sha: head,
					commit: { committer: { date: "2026-10-18T11:00:00Z" } },
				},
			},
			mergedPulls: [mergedPull()],
		});
		expect(olderLimit).toEqual(
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
		const newerLimit = await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			commentsByPull: {
				91: [
					{
						user: { login: grok },
						body: "You have reached your Grok usage limit for code reviews.",
						created_at: "2026-10-18T11:30:00Z",
					},
				],
			},
			commitsBySha: {
				[head]: {
					sha: head,
					commit: { committer: { date: "2026-10-18T11:00:00Z" } },
				},
			},
			mergedPulls: [mergedPull()],
		});
		expect(newerLimit).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok usage limit"],
			),
		);
	});

	test("a Grok review on an older commit stays in review after a new push", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(86)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				86: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
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

	test("a Greptile summary with no running check is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(87)],
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
				87: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->\nConfidence Score: 5/5",
					},
				],
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

	test("a running Greptile check keeps the PR in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(88)],
			checksBySha: {
				[head]: [
					{
						name: "Greptile review",
						status: "in_progress",
						conclusion: null,
						app: { slug: "greptile" },
					},
				],
			},
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
				88: [
					{
						user: { login: greptile },
						body: "<!-- greptile_summary -->",
					},
				],
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

	test("a skipped Grok check counts as passing CI and keeps its warning", async () => {
		const listed = (await overview({
			issues: [issue(8)],
			pulls: [pull(91)],
			withNeedsYou: true,
			checksBySha: {
				[head]: [
					{
						name: "ci",
						status: "completed",
						conclusion: "success",
					},
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "skipped",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
				91: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { body: unknown; needsYou: NeedsYouItem[] };
		expect(listed.body).toEqual(
			card(
				"awaitingMerge",
				{
					backlog: 0,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 1,
				},
				["grok skipped"],
			),
		);
		expect(
			listed.needsYou.find((item) => item.key === `${repo}#8`)?.pull,
		).toMatchObject({
			ci: "passing",
		});
		expect(JSON.stringify(listed.body)).toContain("grok skipped");
	});

	test("a skipped Greptile check is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(89)],
			checksBySha: {
				[head]: [
					{
						name: "Greptile review",
						status: "completed",
						conclusion: "skipped",
						app: { slug: "greptile" },
					},
				],
			},
			commentsByPull: {
				1: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
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
				["greptile skipped"],
			),
		);
	});

	test("a cancelled Grok check on the head commit is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(80)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "cancelled",
						app: { slug: "grok-code-review" },
					},
				],
				[older]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
						app: { slug: "grok-code-review" },
					},
				],
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
				["grok cancelled"],
			),
		);
	});

	test("a Codex review that left only a reaction is awaiting merge with no warning", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(82)],
			reactionsByPull: {
				1: [{ user: { login: codex }, content: "+1" }],
				82: [{ user: { login: codex }, content: "+1" }],
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

	test("a Codex summary with one finished review is awaiting merge", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(99)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				99: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |\n| 📝 **Follow-up** | ⏳ **In progress** | `bbbbbbb` | later |",
					},
				],
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

	test("a Codex in-progress reaction keeps the PR in review", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(90)],
			reactionsByPull: { 90: [{ user: { login: codex }, content: "eyes" }] },
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				90: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `bbbbbbb` | PR opened |",
					},
				],
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

	test("a failed review read does not show the PR as awaiting merge", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		try {
			const result = await run(
				["--config", path],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					databasePath,
					listCheckouts: async () => [],
					fetch: async (input, init) => {
						const url = urlOf(input);
						const sent = typeof init?.body === "string" ? init.body : "";
						if (
							url === "https://api.github.com/graphql" &&
							sent.includes("query RepoRead")
						) {
							return new Response("unavailable", { status: 500 });
						}
						if (url.includes("/reviews?")) {
							return new Response("unavailable", { status: 500 });
						}
						return githubFetch({
							issues: [issue(8)],
							pulls: [pull(98)],
							checksBySha: {},
							commentsByPull: {},
							reviewsByPull: {},
							reactionsByPull: {},
							mergedPulls: [],
						})(input, init);
					},
					readGhToken: async () => null,
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("HTTP 500");
			expect(result.listened).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a warning tag is in the overview", async () => {
		const body = (await overview({
			issues: [issue(8)],
			pulls: [pull(94)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "failure",
					},
				],
			},
			reviewsByPull: {
				1: [{ user: { login: grok }, commit_id: older, state: "COMMENTED" }],
			},
			mergedPulls: [mergedPull()],
		})) as { projects: { tags: string[] }[] };
		expect(body.projects[0]?.tags).toContain("grok failure");
	});

	test("a failed Grok check is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(94)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "failure",
						app: { slug: "grok-code-review" },
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
				["grok failure"],
			),
		);
	});

	test.each([
		["failed", "completed", "failure"],
		["pending", "in_progress", null],
	] as const)(
		"a %s CI check keeps a PR In review after its bot review ends",
		async (_label, status, conclusion) => {
			const body = await overview({
				issues: [issue(8)],
				pulls: [pull(94)],
				checksBySha: {
					[head]: [
						{
							name: "Grok code review",
							status: "completed",
							conclusion: "failure",
							app: { slug: "grok-code-review" },
						},
						{
							name: "test",
							status,
							conclusion,
							app: { slug: "github-actions" },
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
					["grok failure"],
				),
			);
		},
	);

	test("a Codex usage-limit comment is awaiting merge with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(81)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				81: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
					},
				],
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
				["codex usage limit"],
			),
		);
	});

	test("a Codex usage-limit comment newer than the eyes reaction marks Codex done with a warning tag", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(98)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				98: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
						created_at: "2026-10-18T11:30:00Z",
					},
				],
			},
			reactionsByPull: {
				98: [
					{
						user: { login: codex },
						content: "eyes",
						created_at: "2026-10-18T11:00:00Z",
					},
				],
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
				["codex usage limit"],
			),
		);
	});

	test("a Codex eyes reaction stays in review despite a usage-limit comment", async () => {
		const body = await overview({
			issues: [issue(8)],
			pulls: [pull(97)],
			commentsByPull: {
				1: [
					{
						user: { login: codex },
						body: "<!-- codex-pull-request-review-summary -->",
					},
				],
				97: [
					{
						user: { login: codex },
						body: "You have reached your Codex usage limits for code reviews.",
					},
				],
			},
			reactionsByPull: {
				97: [{ user: { login: codex }, content: "eyes" }],
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
