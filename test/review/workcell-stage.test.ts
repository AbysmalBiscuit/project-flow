import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { githubFetch, overview } from "../review-github-fake.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { head, pull, repo } from "../support/github.ts";
import { card, grok, issue, mergedPull, older, progress } from "./_support.ts";

describe("review cycle", () => {
	test("a workcell run at stage 5 or earlier stays in review", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 1: implementing issue 8\n- stage 5: round 1 of 3",
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

	test("an open merge ask on a workcell run is awaiting merge", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
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

	test("a workcell run that ended at its final report with the PR open is awaiting merge", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3\n- final report sent https://github.com/acme/widget/pull/83",
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

	test("a stage line after the final report puts the run back in review", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/83\n- final report sent https://github.com/acme/widget/pull/83\n- stage 1: implementing issue 8 again https://github.com/acme/widget/pull/83",
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

	test("an answered merge ask leaves the run at its stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 3 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
					},
					{ body: "answer: not yet" },
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

	test("a blank final-report ask leaves the run at its stage", async () => {
		const blank = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{ body: progress("- stage 5: round 1 of 3") },
					{ body: "   \n\n<!-- workcell:ask 8-1 -->" },
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
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a blank progress line and repeated spaces still read the stage", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [
					{
						body: `**Workcell progress**\n\n- \n-   stage   5: round 1 of 3`,
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

	test("a stage past 5 with no merge ask and no final report uses the expected bots", async () => {
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			commentsByIssue: {
				8: [{ body: progress("- stage 6: merging") }],
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
			card("inReview", {
				backlog: 0,
				inProgress: 0,
				inReview: 1,
				awaitingMerge: 0,
			}),
		);
	});

	test("a stage line that names a PR as PR https://github.com/owner/repo/pull/N decides that PR only", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 2. PR https://github.com/acme/widget/pull/84. Session 01a150fd.\n- stage 6: merging. PR https://github.com/acme/widget/pull/83. Session 01a150fd.",
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

	test("a stage line that names no PR decides every open PR", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress("- stage 5: round 1 of 2. Session 01a150fd."),
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

	test("an open merge ask on one PR leaves the other open PR at its own stage", async () => {
		const second = "cccccccccccccccccccccccccccccccccccccccc";
		const body = await overview({
			issues: [{ ...issue(8), comments: 2 }],
			pulls: [pull(83), pull(84, 8, second)],
			commentsByIssue: {
				8: [
					{
						body: progress(
							"- stage 5: round 1 of 3 https://github.com/acme/widget/pull/84",
						),
					},
					{
						body: "Merge PR #83 by squash?\n\n<!-- workcell:ask 8-1 -->",
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

	test("a failed comment read does not invent a workcell run", async () => {
		const requests: string[] = [];
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ pinned: [{ tracker: "github", repo }] }),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const databasePath = join(root, "project-flow.sqlite");
		const recorded = githubFetch({
			issues: [{ ...issue(8), comments: 1 }],
			pulls: [pull(83)],
			checksBySha: {
				[head]: [
					{
						name: "Grok code review",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			commentsByPull: {},
			reviewsByPull: {
				83: [{ user: { login: grok }, commit_id: head, state: "COMMENTED" }],
			},
			reactionsByPull: {},
			mergedPulls: [mergedPull()],
		});
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const sent = typeof init?.body === "string" ? init.body : "";
			requests.push(url);
			if (
				url === "https://api.github.com/graphql" &&
				sent.includes("query RepoRead")
			) {
				requests.push("query RepoRead");
				return new Response("recorded failure", { status: 500 });
			}
			if (url.includes("/issues/8/comments")) {
				return new Response("recorded failure", { status: 500 });
			}
			return recorded(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					waitForStop: Promise.resolve(),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(requests.some((url) => url.includes("query RepoRead"))).toBe(true);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
