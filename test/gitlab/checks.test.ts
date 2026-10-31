import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import resultsJobs from "../fixtures/gitlab/merged-results-jobs.json";
import resultsPipeline from "../fixtures/gitlab/merged-results-pipeline.json";
import resultsPull from "../fixtures/gitlab/merged-results-pull.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
import { gitlabRepo, ticketOf, withLinkedPull } from "./_support.ts";

/** The CI of the PR that a Needs you item names. */
async function ciOf(base: string, key: string) {
	const items = (await (
		await fetch(new URL("/api/needs-you", base))
	).json()) as NeedsYouItem[];
	return items.find((item) => item.key === key)?.pull?.ci;
}

async function stateOf(base: string, key: string) {
	return (await ticketOf(base, key))?.state;
}

const [recordedPipeline] = pipelines[1];
if (recordedPipeline === undefined) {
	throw new Error("recorded pipeline of PR !1 is missing");
}

const passedTest = { name: "test", status: "success", allow_failure: false };

describe("the CI of a GitLab PR", () => {
	test("a failed pipeline of external statuses, which has no jobs, keeps its PR In review", async () => {
		await withLinkedPull({}, async (base) => {
			expect(await ciOf(base, "WID-1")).toBe("passing");
			expect(await stateOf(base, `${gitlabRepo}#3`)).toBe("inReview");
		});
	});

	test("a failed merged-results pipeline on a temporary commit keeps the ticket In review", async () => {
		expect(resultsPipeline.sha).not.toBe(resultsPull.sha);
		const [first, ...rest] = resultsJobs;
		await withLinkedPull(
			{
				open: { 1: { sha: resultsPull.sha } },
				pipelines: { 1: [resultsPipeline] },
				jobs: {
					[resultsPipeline.id]: [
						{ ...first, status: "failed", allow_failure: false },
						...rest,
					],
				},
			},
			async (base) => {
				expect(await stateOf(base, "WID-1")).toBe("inReview");
			},
		);
	});

	test.each(["failed", "running", "pending", "canceled"])(
		"a %s pipeline whose listed jobs passed keeps the ticket In review",
		async (status) => {
			await withLinkedPull(
				{
					pipelines: { 1: [{ ...recordedPipeline, status }] },
					jobs: { [recordedPipeline.id]: [passedTest] },
				},
				async (base) => {
					expect(await stateOf(base, "WID-1")).toBe("inReview");
				},
			);
		},
	);

	test("a blocking manual job keeps the ticket In review", async () => {
		await withLinkedPull(
			{
				jobs: {
					[recordedPipeline.id]: [
						passedTest,
						{ name: "deploy", status: "manual", allow_failure: false },
					],
				},
			},
			async (base) => {
				expect(await stateOf(base, "WID-1")).toBe("inReview");
			},
		);
	});

	test("an optional manual job gives passing CI and Awaiting merge", async () => {
		await withLinkedPull(
			{
				jobs: {
					[recordedPipeline.id]: [
						passedTest,
						{ name: "deploy", status: "manual", allow_failure: true },
					],
				},
			},
			async (base) => {
				expect(await stateOf(base, "WID-1")).toBe("awaitingMerge");
				expect(await ciOf(base, "WID-1")).toBe("passing");
			},
		);
	});
});
