import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json, type TrackerRequest, trackerRequest } from "../support/fetch.ts";
import {
	emptyProjectFields,
	pull,
	recordedDiscovery,
	repo,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { settledOverview } from "../support/reads.ts";
import { githubPullNode, repoReadIssues } from "../support/repo-read.ts";
import { pullNode } from "./_support.ts";

const merged = "2026-10-02T00:00:00Z";

const mergedPull = {
	...pull(84, 9),
	state: "closed",
	merged_at: merged,
};

test("the merged history of a Linear project reuses the evidence that a repo read kept", async () => {
	const slug = "widget-launch-0d42ae5d46d0";
	const sent: TrackerRequest[] = [];
	const linear = linearFake({
		project: { id: "project-1", name: "Widget launch", slugId: slug },
		issues: [
			{
				identifier: "WID-83",
				title: "Linear ticket 83",
				updatedAt: "2026-10-01T00:00:00.000Z",
				state: { type: "started" },
				attachments: {
					nodes: [
						{
							url: `https://github.com/${repo}/pull/83`,
							title: "PR 83",
							sourceType: "github",
						},
					],
				},
			},
		],
		github: async (input, init) => {
			const request = trackerRequest(input, init);
			sent.push(request);
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			if (request.query.includes("query RepoRead")) {
				return json(
					repoReadIssues("acme", "widget", [], {
						mergedPulls: [
							githubPullNode({
								...mergedPull,
								commentRows: [
									{
										user: { login: "grok-code-review[bot]" },
										body: "Reviewed the change.",
										created_at: merged,
									},
								],
							}),
						],
					}),
				);
			}
			if (request.query.includes("query PullsByNumber")) {
				return json({ data: { p0: { pullRequest: pullNode(83) } } });
			}
			if (request.url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			if (request.url.includes("/pulls?state=closed")) {
				return json([mergedPull]);
			}
			if (/\/(pulls|issues)\/84\/|\/check-runs|\/status/.test(request.url)) {
				return json(
					request.url.includes("/check-runs") ? { check_runs: [] } : [],
				);
			}
			return emptyProjectFields(input, init) ?? unrecorded(input, init);
		},
	});
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo },
				{ tracker: "linear", project: slug },
			],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let ready: (base: string) => void = () => {};
	const started = new Promise<string>((resolve) => {
		ready = resolve;
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: linear,
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => ready(line),
				waitForStop: (async () => {
					const base = await started;
					const firstPoll = sent.length;
					const refresh = await fetch(new URL("/api/refresh", base), {
						method: "POST",
					});
					expect(refresh.status).toBe(204);
					const overview = await settledOverview(
						base,
						async (url) =>
							(await (await fetch(new URL("/api/overview", url))).json()) as {
								projects: { error: string | null }[];
								polling?: true;
							},
					);
					expect(overview.projects.map((project) => project.error)).toEqual([
						null,
						null,
					]);
					const evidenceReads = sent
						.slice(firstPoll)
						.filter((request) =>
							/\/(pulls|issues)\/84\/|\/commits\//.test(request.url),
						);
					expect(evidenceReads).toEqual([]);
					const needsYou = (await (
						await fetch(new URL("/api/needs-you", base))
					).json()) as NeedsYouItem[];
					expect(needsYou.map((item) => item.key)).not.toContain("WID-83");
				})(),
			}),
		);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr);
		}
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
