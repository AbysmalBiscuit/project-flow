import { describe, expect, test } from "bun:test";

import type { TrackerRequest } from "../support/fetch.ts";
import { head, repo } from "../support/github.ts";
import {
	type Answer,
	type Linked,
	list,
	passing,
	pullNode,
	pullOf,
	pullsByNumberRequests,
	readLinked,
} from "./_support.ts";

const restPullReads = (sent: TrackerRequest[]) =>
	sent.filter((request) =>
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/pulls\/\d+/.test(
			request.url,
		),
	);

describe("linked PRs read through GitHub GraphQL", () => {
	test("a Linear project reads its linked PRs in one GraphQL request per chunk", async () => {
		const numbers = Array.from({ length: 45 }, (_, at) => 100 + at);
		const read = await readLinked(numbers, {
			answers: new Map(numbers.map((number) => [number, pullNode(number)])),
		});
		const batches = pullsByNumberRequests(read.sent);
		expect(
			batches.map((request) => Object.keys(request.variables).length / 3),
		).toEqual([40, 5]);
		expect(restPullReads(read.sent)).toEqual([]);
		expect(read.error).toBeNull();
		expect(read.tickets).toHaveLength(45);
		expect(
			read.tickets.filter((ticket) => ticket.pull !== undefined),
		).toHaveLength(45);
	});

	test("the project shows the CI, reviews and needs-you rows of its linked PRs", async () => {
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[
					83,
					pullNode(83, {
						reviews: list([
							{
								author: { login: "ada" },
								commit: { oid: head },
								state: "APPROVED",
							},
						]),
					}),
				],
				[
					84,
					pullNode(84, {
						statusCheckRollup: {
							contexts: list([
								{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" },
							]),
						},
					}),
				],
				[85, pullNode(85, { isDraft: true })],
			]),
		});
		expect(read.tickets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "WID-83", pull: `${repo}#83` }),
				expect.objectContaining({ key: "WID-84", pull: `${repo}#84` }),
				expect.objectContaining({ key: "WID-85", pull: `${repo}#85` }),
			]),
		);
		expect(read.needsYou.map(({ key, reason }) => ({ key, reason }))).toEqual([
			{ key: "WID-83", reason: "awaitingMerge" },
		]);
		expect(pullOf(read, 83)).toMatchObject({
			number: 83,
			ci: "passing",
			review: "approved",
		});
	});

	test("a linked PR with more checks and reviews than one page shows the later items", async () => {
		const approval = {
			author: { login: "ada" },
			commit: { oid: head },
			state: "APPROVED",
		};
		const failing = {
			name: "test",
			status: "COMPLETED",
			conclusion: "FAILURE",
		};
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[83, pullNode(83, { reviews: list([], "reviews-2") })],
				[
					84,
					pullNode(84, {
						statusCheckRollup: { contexts: list([passing], "checks-2") },
					}),
				],
				[
					85,
					pullNode(85, {
						statusCheckRollup: { contexts: list([passing, failing]) },
					}),
				],
			]),
			laterPages: new Map([
				["PR_83@reviews-2", { reviews: list([approval]) }],
				[
					"PR_84@checks-2",
					{ statusCheckRollup: { contexts: list([failing]) } },
				],
			]),
		});
		expect(read.needsYou.map((item) => item.key)).toEqual(["WID-83"]);
		expect(pullOf(read, 83)).toMatchObject({ review: "approved" });
		const stateOf = (key: string) =>
			read.tickets.find((ticket) => ticket.key === key)?.state;
		expect(stateOf("WID-84")).toBe(stateOf("WID-85"));
		expect(stateOf("WID-84")).not.toBe(stateOf("WID-83"));
	});

	test("a merged linked PR gives the merged history its evidence from all pages", async () => {
		const merged = "2026-10-02T00:00:00Z";
		const linked: Linked = {
			answers: new Map<number, Answer>([
				[83, pullNode(83)],
				[
					84,
					pullNode(84, {
						state: "MERGED",
						mergedAt: merged,
						reviews: list([], "reviews-2"),
					}),
				],
			]),
			laterPages: new Map([
				[
					"PR_84@reviews-2",
					{
						reviews: list([
							{
								author: { login: "grok-code-review[bot]" },
								commit: { oid: head },
								state: "COMMENTED",
							},
						]),
					},
				],
			]),
			closed: [
				{
					number: 84,
					title: "PR 84",
					html_url: `https://github.com/${repo}/pull/84`,
					body: "",
					head: { ref: "84-feat", sha: head },
					state: "closed",
					merged_at: merged,
				},
			],
			inferBots: true,
			again: () => {},
		};
		const read = await readLinked([83, 84], linked);
		const evidenceReads = read.sent.filter((request) =>
			/\/(pulls|issues)\/84\/|\/commits\//.test(request.url),
		);
		expect(evidenceReads).toEqual([]);
		expect(read.before?.needsYou).toEqual([]);
		expect(read.needsYou).toEqual([]);
		const lastBatch = pullsByNumberRequests(read.sent).at(-1);
		const at = Object.entries(lastBatch?.variables ?? {}).find(
			([name, value]) => name.startsWith("number") && value === 84,
		)?.[0];
		const field = lastBatch?.query
			.split(`p${at?.slice("number".length)}: repository`)[1]
			?.split(/\n\tp\d+: repository/)[0];
		expect(field).toContain("headRefOid");
		expect(field).not.toContain("reviews(");
	});
});
