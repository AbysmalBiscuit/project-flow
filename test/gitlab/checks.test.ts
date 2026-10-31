import { describe, expect, test } from "bun:test";

import type { NeedsYouItem } from "../../src/domain.ts";
import resultsJobs from "../fixtures/gitlab/merged-results-jobs.json";
import resultsPipeline from "../fixtures/gitlab/merged-results-pipeline.json";
import resultsPull from "../fixtures/gitlab/merged-results-pull.json";
import pipelines from "../fixtures/gitlab/pipelines.json";
import { gitlabRepo, withLinkedPull } from "./_support.ts";

/** The CI of the PR that a Needs you item names. */
async function ciOf(base: string, key: string) {
	const items = (await (
		await fetch(new URL("/api/needs-you", base))
	).json()) as NeedsYouItem[];
	return items.find((item) => item.key === key)?.pull?.ci;
}

const [recordedPipeline] = pipelines[1];
if (recordedPipeline === undefined) {
	throw new Error("recorded pipeline of PR !1 is missing");
}

describe("the CI of a GitLab PR", () => {
	test("a failed pipeline of external statuses, which has no jobs, is failing CI", async () => {
		await withLinkedPull({}, async (base) => {
			expect(await ciOf(base, "WID-1")).toBe("passing");
			expect(await ciOf(base, `${gitlabRepo}#3`)).toBe("failing");
		});
	});

	test("a failed merged-results pipeline on a temporary commit is failing CI", async () => {
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
				expect(await ciOf(base, "WID-1")).toBe("failing");
			},
		);
	});

	test("a failed pipeline whose listed jobs passed, such as a failed trigger job, is failing CI", async () => {
		await withLinkedPull(
			{
				pipelines: { 1: [{ ...recordedPipeline, status: "failed" }] },
				jobs: {
					[recordedPipeline.id]: [
						{ name: "test", status: "success", allow_failure: false },
					],
				},
			},
			async (base) => {
				expect(await ciOf(base, "WID-1")).toBe("failing");
			},
		);
	});

	test.each([
		["running", "pending"],
		["pending", "pending"],
		["canceled", "failing"],
	] as const)(
		"a %s pipeline whose listed jobs passed gives %s CI",
		async (status, ci) => {
			await withLinkedPull(
				{
					pipelines: { 1: [{ ...recordedPipeline, status }] },
					jobs: {
						[recordedPipeline.id]: [
							{ name: "test", status: "success", allow_failure: false },
						],
					},
				},
				async (base) => {
					expect(await ciOf(base, "WID-1")).toBe(ci);
				},
			);
		},
	);

	test.each([
		[false, "pending"],
		[true, "passing"],
	] as const)(
		"a manual job with allow_failure %p gives %s CI",
		async (allowFailure, ci) => {
			await withLinkedPull(
				{
					jobs: {
						[recordedPipeline.id]: [
							{ name: "test", status: "success", allow_failure: false },
							{ name: "deploy", status: "manual", allow_failure: allowFailure },
						],
					},
				},
				async (base) => {
					expect(await ciOf(base, "WID-1")).toBe(ci);
				},
			);
		},
	);
});
