import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { projectBoard } from "./review-board.ts";
import { connection, page } from "./review-github-fake.ts";
import { pull, repo } from "./review-support.ts";
import {
	emptyProjectFields,
	githubIssueNode,
	githubPullNode,
	linearFake,
	recordedDiscovery,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

describe("skipped linked PRs", () => {
	const brokenPull = "https://api.github.com/repos/acme/widget/pulls/84";

	function readsBrokenPull(url: string, sent: string): boolean {
		if (url === brokenPull || url.startsWith(`${brokenPull}/`)) {
			return true;
		}
		if (!sent.includes("query NestedReview")) {
			return false;
		}
		const { variables } = JSON.parse(sent) as { variables: { number: number } };
		return variables.number === 84;
	}

	function linkedPull(number: number, ticket: number) {
		return { ...pull(number, ticket), body: `Fixes ticket ${ticket}` };
	}

	const mergedPull = {
		...linkedPull(84, 9),
		state: "closed",
		merged_at: "2026-10-02T00:00:00Z",
	};

	async function skippedThenShown(
		config: Record<string, unknown>,
		tracker: Fetch,
		env: Record<string, string>,
		history: "open" | "merged" = "open",
	): Promise<void> {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				...config,
				expectedBots: { [repo]: [] },
				pollIntervalSeconds: 3600,
			}),
		);
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		let broken = true;
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			const sent = typeof init?.body === "string" ? init.body : "";
			if (broken && readsBrokenPull(url, sent)) {
				return new Response("recorded failure", { status: 500 });
			}
			if (history === "merged" && url === brokenPull) {
				return page(mergedPull);
			}
			if (history === "merged" && url.includes("/pulls?state=closed")) {
				return page([mergedPull]);
			}
			return tracker(input, init);
		};
		const readTickets = async (base: string) => {
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as { projects: { name: string }[] };
			const project = overview.projects[0]?.name ?? "";
			const response = await fetch(
				new URL(`/api/projects/${encodeURIComponent(project)}`, base),
			);
			expect(response.status).toBe(200);
			const report = (await response.json()) as {
				tickets: { key: string; pull?: string }[];
			};
			return report.tickets.map(({ key, pull }) => ({ key, pull }));
		};
		let startChecks: (base: string) => void = () => {};
		const checks = new Promise<string>((resolve) => {
			startChecks = (base: string) => resolve(base);
		});
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env,
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-10-18T12:00:00.000Z"),
					stdout: (line) => startChecks(line),
					waitForStop: (async () => {
						const base = await checks;
						const skipped = await fetch(new URL("/api/overview", base));
						expect(await skipped.json()).toMatchObject({
							projects: [{ error: null }],
						});
						expect(await readTickets(base)).toEqual(
							expect.arrayContaining([
								{ key: expect.stringMatching(/8$/), pull: `${repo}#83` },
								{ key: expect.stringMatching(/9$/), pull: undefined },
							]),
						);
						broken = false;
						const refresh = await fetch(new URL("/api/refresh", base), {
							method: "POST",
						});
						expect(refresh.status).toBe(204);
						const shown = await settledOverview(base, async (url) => {
							const response = await fetch(new URL("/api/overview", url));
							return (await response.json()) as {
								projects: { error: string | null }[];
								polling?: true;
							};
						});
						expect(shown).toMatchObject({ projects: [{ error: null }] });
						expect(await readTickets(base)).toEqual(
							expect.arrayContaining([
								{ key: expect.stringMatching(/8$/), pull: `${repo}#83` },
								{ key: expect.stringMatching(/9$/), pull: `${repo}#84` },
							]),
						);
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
	}

	test.each(["open", "merged"] as const)(
		"a GitHub project skips a broken %s linked PR until the next good poll",
		async (history) => {
			const board = projectBoard(
				[{ number: 83 }],
				undefined,
				[],
				[
					{
						id: "I_widget_9",
						number: 9,
						title: "Ticket 9",
						pulls: [{ number: 84 }],
						comments: [],
					},
				],
			);
			await skippedThenShown(
				{ pinned: [{ tracker: "github", owner: "acme", project: 7 }] },
				async (input, init) => {
					const number = urlOf(input).match(
						/^https:\/\/api\.github\.com\/repos\/acme\/widget\/pulls\/(\d+)$/,
					)?.[1];
					return number === undefined
						? board(input, init)
						: page(linkedPull(Number(number), Number(number) - 75));
				},
				{ GITHUB_TOKEN: "recorded-token" },
				history,
			);
		},
	);

	test.each(["open", "merged"] as const)(
		"a Linear project skips a broken %s linked PR until the next good poll",
		async (history) => {
			const linearProject = "widget-launch-0d42ae5d46d0";
			const attached = (ticket: number, number: number) => ({
				identifier: `WID-${ticket}`,
				title: `Linear ticket ${ticket}`,
				updatedAt: "2026-10-01T00:00:00.000Z",
				state: { type: "started" },
				attachments: {
					nodes: [
						{
							url: `https://github.com/${repo}/pull/${number}`,
							title: `PR ${number}`,
							sourceType: "github",
						},
					],
				},
			});
			const linear = linearFake({
				project: {
					id: "project-1",
					name: "Widget launch",
					slugId: linearProject,
				},
				issues: [attached(8, 83), attached(9, 84)],
				github: async (input, init) => {
					const discovered = recordedDiscovery(input, init);
					if (discovered !== null) {
						return discovered;
					}
					const url = urlOf(input);
					if (url === "https://api.github.com/user") {
						return page({ login: "lev" });
					}
					const number = url.match(
						/^https:\/\/api\.github\.com\/repos\/acme\/widget\/pulls\/(\d+)$/,
					)?.[1];
					if (number !== undefined) {
						return page(linkedPull(Number(number), Number(number) - 75));
					}
					if (url.includes("/commits/") && url.includes("/check-runs")) {
						return page({ check_runs: [] });
					}
					if (url.includes("/commits/")) {
						return page({
							commit: { committer: { date: "2026-10-01T00:00:00Z" } },
						});
					}
					if (
						url.includes("/pulls?state=closed") ||
						url.includes("/comments") ||
						url.includes("/reviews") ||
						url.includes("/reactions")
					) {
						return page([]);
					}
					return emptyProjectFields(input, init) ?? unrecorded(input);
				},
			});
			await skippedThenShown(
				{ pinned: [{ tracker: "linear", project: linearProject }] },
				linear,
				{
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				history,
			);
		},
	);

	test("a GitHub repo skips a linked PR with a broken review page until the next good poll", async () => {
		const board = projectBoard();
		const issues = [8, 9].map((number) =>
			githubIssueNode({ number, title: `Ticket ${number}` }),
		);
		const pulledReviews = (number: number) => ({
			...connection([]),
			pageInfo: { hasNextPage: true, endCursor: `review-${number}` },
		});
		await skippedThenShown(
			{ tracked: [{ tracker: "github", repo }] },
			async (input, init) => {
				const sent = typeof init?.body === "string" ? init.body : "";
				if (sent.includes("query RepoRead")) {
					const pulls = [83, 84].map((number) => ({
						...githubPullNode(pull(number, number - 75)),
						reviews: pulledReviews(number),
					}));
					return page(repoReadIssues("acme", "widget", issues, { pulls }));
				}
				if (sent.includes("query NestedReview")) {
					return page({
						data: {
							repository: { pullRequest: { reviews: connection([]) } },
						},
					});
				}
				return board(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
		);
	});
});
