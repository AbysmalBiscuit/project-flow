import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";

const openAndRunAnswered = `Closes #8

### Important Questions

<details><summary><b>1. redefines label start scope:</b> Should <code>startedBy</code> end a box label start only at a hub run on that box?</summary>

\`startedBy\` in \`src/run-start.ts\` now ends a box label start at any new hub-source run of the ticket.

</details>

<details><summary><b>2. duplicates box-to-hub mapping:</b> Should <code>startedBy</code> match the run box?</summary>

\`mergedRuns\` in \`src/factory-run-rows.ts\` takes \`sourceFactory\` from the first hub row of the run id.

</details>

### Answers

#### First round

2. duplicates box-to-hub mapping: Should startedBy match the run box? | Verdict: Ask | Answer: No branch change. Why:
   1. The handoff excludes other factories.
   2. The hub row names the factory.

## Proof

1. ✅ Test passes.
`;

const allRunAnswered = `A fix with no ticket.

### Important Questions

<details><summary><b>1. duplicates start request end:</b> Should a label start end by the <code>known</code> run ids?</summary>

\`settledRequests\` in \`src/run-start.ts:118\` ends a claim by run ids.

</details>

### Answers

#### First round

1. duplicates start request end: Should a label start end by the known run ids? | Verdict: Ask | Answer: No branch change. Why: the time comparison stays.

## Proof

1. ✅ Test passes.
`;

describe("needs you", () => {
	test("asks Lev to decide an awaiting PR with an open Important Question", async () => {
		const repo = "acme/widget";
		const recorded: Fetch = async (input, init) => {
			const discovered = recordedDiscovery(input, init);
			if (discovered !== null) {
				return discovered;
			}
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return Response.json({ login: "lev" });
			}
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("query RepoRead")) {
					const read = await repoReadFromHandler(input, init, recorded);
					if (read !== null) {
						return read;
					}
				}
				return Response.json({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				});
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page([
					{
						number: 8,
						title: "Ship the widget",
						state: "open",
						state_reason: null,
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						comments: 0,
						assignee: null,
						labels: [],
					},
				]);
			}
			if (
				url ===
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`
			) {
				return page([
					{
						number: 40,
						title: "Ship the widget",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/40`,
						head: { ref: "40-ship", sha: "sha-40" },
						body: openAndRunAnswered,
						merged_at: null,
					},
					{
						number: 92,
						title: "A fix with no ticket",
						state: "open",
						draft: false,
						html_url: `https://github.com/${repo}/pull/92`,
						head: { ref: "pr-92", sha: "sha-92" },
						body: allRunAnswered,
						merged_at: null,
					},
				]);
			}
			if (url.includes("/check-runs")) {
				return Response.json({
					check_runs: [
						{ name: "ci", status: "completed", conclusion: "success" },
					],
				});
			}
			if (url.includes("/commits/")) {
				return Response.json({
					commit: { committer: { date: "2026-10-01T00:00:00Z" } },
				});
			}
			if (
				url.includes("/pulls?state=closed") ||
				url.includes("/labels?") ||
				url.includes("/branches?") ||
				url.includes("/comments") ||
				url.includes("/reviews") ||
				url.includes("/reactions")
			) {
				return page([]);
			}
			return unrecorded(input);
		};
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				pinned: [{ tracker: "github", repo }],
				pmBot: { [repo]: false },
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<NeedsYouItem[]>((resolve, reject) => {
			startChecks = (base) => {
				fetch(new URL("/api/needs-you", base))
					.then(async (response) => {
						expect(response.status).toBe(200);
						resolve((await response.json()) as NeedsYouItem[]);
					})
					.catch(reject);
			};
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: recorded,
					readGhToken: async () => null,
					databasePath: join(root, "store.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: checks.then(() => undefined),
				}),
			);
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);
			const items = await checks;
			expect(items.find((item) => item.key === `${repo}#8`)).toMatchObject({
				reason: "decide",
				openQuestions: 1,
				pull: { number: 40 },
			});
			const answered = items.find((item) => item.key === `${repo}#92`);
			expect(answered).toMatchObject({ reason: "awaitingMerge" });
			expect(answered).not.toHaveProperty("openQuestions");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});
});
