import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { githubFetch, page } from "../review-github-fake.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { head, pull, repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { readOverview, settledOverview } from "../support/reads.ts";
import { greptile, older } from "./_support.ts";

const linearProject = "widget-launch-0d42ae5d46d0";

const mergedClose = {
	number: 99,
	title: "PR 99",
	state: "closed",
	draft: false,
	html_url: `https://github.com/${repo}/pull/99`,
	head: { ref: "99-feat", sha: older },
	body: "Closes WID-8",
	merged_at: "2026-10-01T00:00:00Z",
};

function linearIssue(number: number, pullNumber: number) {
	return {
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "started" },
		attachments: {
			nodes: [
				{
					url: `https://github.com/${repo}/pull/${pullNumber}`,
					title: `PR ${pullNumber}`,
					sourceType: "github",
				},
			],
		},
	};
}

describe("review cycle", () => {
	test("an incremental Linear poll with no changed issue keeps the Done state and the expected bots", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearProject }],
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		const issues: Record<string, unknown>[] = [
			linearIssue(8, 99),
			linearIssue(9, 100),
		];
		const listed: string[] = [];
		const recorded = githubFetch({
			issues: [],
			pulls: [],
			checksBySha: {},
			commentsByPull: {
				99: [{ user: { login: greptile }, body: "<!-- greptile_summary -->" }],
			},
			reviewsByPull: {},
			reactionsByPull: {},
			mergedPulls: [mergedClose],
		});
		const github: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === `https://api.github.com/repos/${repo}/pulls/99`) {
				return page(mergedClose);
			}
			if (url === `https://api.github.com/repos/${repo}/pulls/100`) {
				return page(pull(100, 9, head));
			}
			return recorded(input, init);
		};
		let clock = Date.parse("2026-10-18T12:00:00.000Z");
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFake({
						project: {
							id: "project-1",
							name: "Widget launch",
							slugId: linearProject,
						},
						issues,
						requests: listed,
						github,
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date(clock),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const counts = async () => {
				const project = (await readOverview<Overview>(base)).projects[0];
				return {
					done: project?.done,
					inReview: project?.inReview,
					awaitingMerge: project?.awaitingMerge,
				};
			};
			const expected = { done: 1, inReview: 1, awaitingMerge: 0 };
			expect(await counts()).toEqual(expected);
			const before = listed.length;
			issues.length = 0;
			clock += 60 * 1000;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview<Overview>);
			expect(listed.slice(before).some((body) => body.includes('"gte"'))).toBe(
				true,
			);
			expect(await counts()).toEqual(expected);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
