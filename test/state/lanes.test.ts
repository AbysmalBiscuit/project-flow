import { describe, expect, test } from "bun:test";

import approvedState from "../fixtures/linear-approved-state.json";
import { urlOf } from "../support/fetch.ts";
import { page, repo as githubRepo, unrecorded } from "../support/github.ts";
import {
	boardFetch,
	boardItem,
	devkitWorktree,
	githubIssue,
	linearIssue,
	linearSlug,
	needsYouOf,
	progress,
	progressState,
	projectOf,
	pullAs,
	recordedJson,
	recordedLinear,
	type RecordedPull,
	recordedRepo,
	ticketOf,
	todoState,
	withApp,
} from "./_support.ts";

describe("forward state", () => {
	test("a Linear ticket in Todo with a live workcell run is In progress with a Stale status of Todo", async () => {
		const checkout = await devkitWorktree({ key: "WID-1", status: "running" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-1", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 1: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-1")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
						statusType: "inProgress",
						staleStatus: "Todo",
						chips: ["Todo"],
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a merged PR moves its ticket to Done only when the body closes the ticket", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(8, { updated_at: "2026-08-18T12:00:00.000Z" }),
					githubIssue(9, { updated_at: "2026-08-18T12:00:00.000Z" }),
				],
				[],
				[
					pullAs(merged, { number: 40, body: "Closes #8", state: "closed" }),
					pullAs(merged, {
						number: 41,
						body: "Partial work for #9",
						state: "closed",
					}),
				],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "done",
					lane: "Done",
					statusType: "done",
				});
				expect(ticketOf(report, `${githubRepo}#9`)).toMatchObject({
					state: "backlog",
					lane: "Backlog",
				});
			},
		);
	});

	test("a Linear ticket in Approved moves to Done when its merged PR closes it", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear(
				[
					linearIssue("WID-2", "Land the branch", approvedState, {
						attachments: {
							nodes: [
								{
									url: "https://github.com/acme/widget/pull/83",
									title: merged.title,
									sourceType: "github",
								},
							],
						},
					}),
				],
				async (input) => {
					const url = urlOf(input);
					if (url === "https://api.github.com/user") {
						return Response.json({ login: "lev" });
					}
					if (url === `https://api.github.com/repos/${githubRepo}/pulls/83`) {
						return Response.json(
							pullAs(merged, {
								number: 83,
								body: "Closes WID-2",
								state: "closed",
							}),
						);
					}
					if (url.includes("/pulls?state=closed")) {
						return page([]);
					}
					return unrecorded(input);
				},
			),
			{
				LINEAR_API_KEY: "recorded-linear-key",
				GITHUB_TOKEN: "recorded-token",
			},
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-2")).toMatchObject({
					state: "done",
					lane: "Done",
					statusType: "done",
				});
			},
		);
	});

	test("a failed run with a merged PR that closes the ticket is Done with no Run failed chip", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		const checkout = await devkitWorktree({ key: "WID-2", status: "failed" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear(
					[
						linearIssue("WID-2", "Land the branch", approvedState, {
							attachments: {
								nodes: [
									{
										url: "https://github.com/acme/widget/pull/83",
										title: merged.title,
										sourceType: "github",
									},
								],
							},
						}),
					],
					async (input) => {
						const url = urlOf(input);
						if (url === "https://api.github.com/user") {
							return Response.json({ login: "lev" });
						}
						if (url === `https://api.github.com/repos/${githubRepo}/pulls/83`) {
							return Response.json(
								pullAs(merged, {
									number: 83,
									body: "Closes WID-2",
									state: "closed",
								}),
							);
						}
						if (url.includes("/pulls?state=closed")) {
							return page([]);
						}
						return unrecorded(input);
					},
				),
				{
					LINEAR_API_KEY: "recorded-linear-key",
					GITHUB_TOKEN: "recorded-token",
				},
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					const ticket = ticketOf(report, "WID-2");
					expect(ticket).toMatchObject({
						state: "done",
						lane: "Done",
						statusType: "done",
					});
					expect(ticket.chips ?? []).not.toContain("Run failed");
					expect(
						needsYouOf(report).filter((row) => row.key === "WID-2"),
					).toEqual([]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run returns the ticket to its tracker lane with Run failed and a needs-you item", async () => {
		const checkout = await devkitWorktree({ key: "WID-4", status: "failed" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-4", "Retry the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 2: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-4")).toMatchObject({
						state: "backlog",
						status: "Todo",
						statusType: "backlog",
						chips: ["Run failed"],
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === "WID-4")
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run with a pushed branch stays in its tracker lane with Run failed", async () => {
		const checkout = await devkitWorktree({
			key: `${githubRepo}#4`,
			status: "failed",
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo(
					[githubIssue(4, { title: "Retry the list" })],
					[],
					[],
					{ allow_auto_merge: false },
					[{ name: "4-feat" }],
				),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(ticketOf(report, `${githubRepo}#4`)).toMatchObject({
						state: "backlog",
						lane: "Backlog",
						chips: ["Run failed"],
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === `${githubRepo}#4`)
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run with a started todo stays in its tracker lane with Run failed", async () => {
		const checkout = await devkitWorktree({
			key: `${githubRepo}#4`,
			status: "failed",
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo([githubIssue(4, { title: "Retry the list" })]),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(ticketOf(report, `${githubRepo}#4`)).toMatchObject({
						state: "backlog",
						lane: "Backlog",
						chips: ["Run failed"],
					});
				},
				checkout.root,
				undefined,
				`- [ ] Retry the list (${githubRepo}#4, in progress)\n`,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run with an open PR out of draft is In review with Run failed", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		const checkout = await devkitWorktree({
			key: `${githubRepo}#4`,
			status: "failed",
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo(
					[githubIssue(4, { title: "Retry the list" })],
					[pullAs(recorded, { number: 40, body: "Closes #4", state: "open" })],
					[],
					repo,
				),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(ticketOf(report, `${githubRepo}#4`)).toMatchObject({
						state: "inReview",
						lane: "In review",
						chips: ["Run failed"],
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === `${githubRepo}#4`)
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run with an open draft PR is In progress with Run failed", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const checkout = await devkitWorktree({
			key: `${githubRepo}#4`,
			status: "failed",
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo(
					[githubIssue(4, { title: "Retry the list" })],
					[
						{
							...pullAs(recorded, {
								number: 40,
								body: "Closes #4",
								state: "open",
							}),
							draft: true,
						},
					],
				),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(ticketOf(report, `${githubRepo}#4`)).toMatchObject({
						state: "inProgress",
						lane: "In progress",
						chips: ["Run failed"],
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a blocked ticket stays in its lane with the blocked flag", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear([
				linearIssue("WID-5", "Wait on the schema", progressState, {
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									identifier: "WID-6",
									title: "Ship the schema",
									state: { type: "unstarted" },
									project: { name: "Widget launch", slugId: linearSlug },
								},
							},
						],
					},
				}),
				linearIssue("WID-6", "Ship the schema", todoState),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-5")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					statusType: "inProgress",
					blocked: true,
					chips: ["Blocked"],
				});
			},
		);
	});

	test("a GitHub project board ticket with a live run on its repo is In progress", async () => {
		const checkout = await devkitWorktree({ key: "8", status: "running" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "github", owner: "acme", project: 4 }],
				}),
				boardFetch([
					boardItem(8, "Draw the nodes", { name: "Backlog", color: "GREEN" }),
				]),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, "Widget board");
					expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
						state: "inProgress",
						lane: "In progress",
						statusType: "inProgress",
						staleStatus: "Backlog",
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a merged PR body Closes #N moves a GitHub project board ticket to Done", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			boardFetch(
				[
					boardItem(8, "Draw the nodes", {
						name: "In review",
						color: "PURPLE",
					}),
				],
				[pullAs(merged, { number: 40, body: "Closes #8", state: "closed" })],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "done",
					lane: "Done",
					statusType: "done",
				});
			},
		);
	});
});
