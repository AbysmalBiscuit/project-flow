import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { json, trackerRequest } from "../support/fetch.ts";
import { pull, repo, unrecorded } from "../support/github.ts";
import { settledOverview } from "../support/reads.ts";
import {
	emptyConnection,
	githubIssueNode,
	githubPullNode,
	repoReadIssues,
} from "../support/repo-read.ts";

type Project = { name: string; error: string | null; polling?: true };

async function readPulls(base: string) {
	const overview = await settledOverview(
		base,
		async (url) =>
			(await (await fetch(new URL("/api/overview", url))).json()) as {
				projects: Project[];
				polling?: true;
			},
	);
	const project = overview.projects[0];
	const report = (await (
		await fetch(
			new URL(`/api/projects/${encodeURIComponent(project?.name ?? "")}`, base),
		)
	).json()) as { tickets: { key: string; pull?: string }[] };
	return {
		error: project?.error ?? null,
		pulls: report.tickets.map(({ key, pull }) => ({ key, pull })),
	};
}

describe("batched GitHub reads", () => {
	test("a malformed PR page fails a repo poll, which keeps the PRs of the last good poll", async () => {
		let malformed = false;
		const github: Fetch = async (input, init) => {
			const sent = trackerRequest(input, init);
			if (sent.query.includes("query RepoRead")) {
				return json(
					repoReadIssues(
						"acme",
						"widget",
						[githubIssueNode({ number: 8, title: "Ticket 8" })],
						{
							pulls: [
								{
									...githubPullNode(pull(83, 8)),
									reviews: {
										nodes: [],
										pageInfo: { hasNextPage: true, endCursor: "reviews-2" },
									},
								},
							],
						},
					),
				);
			}
			if (sent.query.includes("query RepoPages")) {
				return json({
					data: {
						c0: { reviews: malformed ? "malformed" : emptyConnection },
					},
				});
			}
			if (sent.url === "https://api.github.com/user") {
				return json({ login: "lev" });
			}
			return unrecorded(input, init);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo }],
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let ready: (base: string) => void = () => {};
		const started = new Promise<string>((resolve) => {
			ready = resolve;
		});
		const shown = [{ key: `${repo}#8`, pull: `${repo}#83` }];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: github,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => ready(line),
					waitForStop: (async () => {
						const base = await started;
						const good = await readPulls(base);
						expect(good.error).toBeNull();
						expect(good.pulls).toEqual(shown);
						malformed = true;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const failed = await readPulls(base);
						expect(failed.error).not.toBeNull();
						expect(failed.pulls).toEqual(shown);
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
});
