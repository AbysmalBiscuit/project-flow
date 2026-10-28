import { describe, expect, test } from "bun:test";

import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import { page, repo as githubRepo, unrecorded } from "../support/github.ts";
import {
	devkitWorktree,
	githubIssue,
	linearIssue,
	linearSlug,
	needsYouOf,
	progress,
	projectOf,
	pullAs,
	recordedJson,
	recordedLinear,
	type RecordedPull,
	recordedRepo,
	ticketOf,
	withApp,
} from "./_support.ts";

const reviewState = {
	id: "558ba933-745c-42e2-8969-b3757c54bd5c",
	name: "In Review",
	type: "started",
	color: "#4cb782",
};

describe("forward state", () => {
	test("a finished review cycle is Awaiting merge and needs you when auto-merge is off or ask", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const awaiting = {
			lane: "Awaiting merge",
			state: "awaitingMerge",
			reason: "awaitingMerge",
		} as const;
		const cases = [
			{ manifest: { merge: "no" }, ...awaiting },
			{ manifest: { merge: "ask" }, ...awaiting },
			{
				manifest: { merge: "yes" },
				lane: "In review",
				status: "In Review",
				state: "inReview",
				reason: null,
			},
			{ manifest: { workflow: "no" }, ...awaiting },
			{ manifest: { merge: "yes", workflow: "no" }, ...awaiting },
		] as const;
		for (const item of cases) {
			const checkout = await devkitWorktree({
				key: "WID-2",
				status: "running",
				mergeAuto: item.manifest,
			});
			try {
				await withApp(
					JSON.stringify({
						pinned: [{ tracker: "linear", project: linearSlug }],
					}),
					recordedLinear(
						[
							linearIssue("WID-2", "Land the branch", reviewState, {
								comments: {
									nodes: [
										{
											id: "c1",
											body: progress(
												"- stage 5: round 1 of 3\n- final report sent https://github.com/acme/widget/pull/83",
											),
											createdAt: "2026-08-18T13:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/83",
											title: "PR 83",
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
							if (
								url === `https://api.github.com/repos/${githubRepo}/pulls/83`
							) {
								return Response.json(
									pullAs(recorded, {
										number: 83,
										body: "Closes WID-2",
										state: "open",
									}),
								);
							}
							if (url.includes("/pulls?state=closed")) {
								return page([]);
							}
							if (
								url.includes("/comments") ||
								url.includes("/reviews") ||
								url.includes("/reactions")
							) {
								return page([]);
							}
							if (url.includes("/check-runs")) {
								return Response.json({ check_runs: [] });
							}
							if (url.includes("/commits/")) {
								return Response.json({
									commit: { committer: { date: "2026-08-18T11:00:00.000Z" } },
								});
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
							state: item.state,
							lane: item.lane,
							...("status" in item ? { status: item.status } : {}),
						});
						const needs = needsYouOf(report)
							.filter((row) => row.key === "WID-2")
							.map((row) => row.reason);
						expect(needs).toEqual(item.reason === null ? [] : [item.reason]);
					},
					checkout.root,
				);
			} finally {
				await checkout.cleanup();
			}
		}
	});

	test("a GitHub repo that allows auto-merge keeps a finished review cycle in review", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				expect(
					needsYouOf(report).filter((row) => row.key === `${githubRepo}#8`),
				).toEqual([]);
			},
		);
	});

	test("a configuration auto-merge override of yes keeps a finished review cycle in review", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				autoMerge: { [githubRepo]: "yes" },
			}),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				expect(
					needsYouOf(report).filter((row) => row.key === `${githubRepo}#8`),
				).toEqual([]);
			},
		);
	});

	test("a second poll keeps a repo auto-merge setting when another project fetch fails", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		let polls = 0;
		const github = recordedRepo(
			[githubIssue(8)],
			[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
			[],
			repo,
		);
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/graphql") {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("ProjectByNumber")) {
					polls += 1;
					if (polls > 1) {
						return new Response("recorded project failure", { status: 500 });
					}
					return Response.json({
						data: {
							repositoryOwner: {
								projectV2: {
									id: "PVT_other",
									number: 9,
									title: "Other board",
									closed: false,
									updatedAt: "2026-08-18T12:00:00Z",
								},
							},
						},
					});
				}
				if (body.includes("ProjectItems") || body.includes("ProjectFields")) {
					return Response.json({
						data: {
							node: body.includes("ProjectFields")
								? { fields: { nodes: [] } }
								: {
										items: {
											nodes: [],
											pageInfo: { hasNextPage: false, endCursor: null },
										},
									},
						},
					});
				}
			}
			return github(input, init);
		};
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", owner: "acme", project: 9 },
				],
				pollIntervalSeconds: 3600,
			}),
			fetchImpl,
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const first = await projectOf(base, githubRepo);
				expect(ticketOf(first, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				const second = await projectOf(base, githubRepo);
				expect(ticketOf(second, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				expect(
					needsYouOf(second).filter((row) => row.key === `${githubRepo}#8`),
				).toEqual([]);
				const inbox = await fetch(new URL("/api/inbox", base));
				expect(inbox.status).toBe(200);
				const notes = (await inbox.json()) as {
					key: string;
					trigger: string;
				}[];
				expect(notes.filter((note) => note.key === `${githubRepo}#8`)).toEqual(
					[],
				);
			},
		);
	});

	test("a configuration auto-merge override of no beats a repo that allows auto-merge", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				autoMerge: { [githubRepo]: "no" },
			}),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "awaitingMerge",
					lane: "Awaiting merge",
				});
				expect(
					needsYouOf(report)
						.filter((row) => row.key === `${githubRepo}#8`)
						.map((row) => row.reason),
				).toEqual(["awaitingMerge"]);
			},
		);
	});

	test("an unlinked PR with finished reviews is not in Needs you when the repo allows auto-merge", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[],
				[
					pullAs(recorded, {
						number: 90,
						body: "A fix with no ticket.",
						state: "open",
					}),
				],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(needsYouOf(report).map((row) => row.key)).toEqual([]);
			},
		);
	});

	test("workcell merge_auto yes leaves an unlinked PR that no workcell run opened in Needs you", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const checkout = await devkitWorktree({
			key: `${githubRepo}#8`,
			status: "running",
			mergeAuto: { workflow: "yes" },
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo(
					[],
					[
						pullAs(recorded, {
							number: 90,
							body: "A fix with no ticket.",
							state: "open",
						}),
					],
				),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(
						needsYouOf(report).map((row) => [row.key, row.reason]),
					).toEqual([[`${githubRepo}#90`, "awaitingMerge"]]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("workcell merge_auto yes keeps only a PR that a workcell progress comment names out of Awaiting merge", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const cases = [
			{
				comment: progress(
					"- stage 5: round 1 of 3\n- final report sent https://github.com/acme/widget/pull/83",
				),
				lane: "In review",
				state: "inReview",
				reasons: [],
			},
			{
				comment: "Opened https://github.com/acme/widget/pull/83 by hand.",
				lane: "Awaiting merge",
				state: "awaitingMerge",
				reasons: ["awaitingMerge"],
			},
		] as const;
		for (const item of cases) {
			const checkout = await devkitWorktree({
				key: "WID-9",
				status: "running",
				mergeAuto: { workflow: "yes" },
			});
			try {
				await withApp(
					JSON.stringify({
						pinned: [{ tracker: "linear", project: linearSlug }],
					}),
					recordedLinear(
						[
							linearIssue("WID-2", "Land the branch", reviewState, {
								comments: {
									nodes: [
										{
											id: "c1",
											body: item.comment,
											createdAt: "2026-08-18T13:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/83",
											title: "PR 83",
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
							if (
								url === `https://api.github.com/repos/${githubRepo}/pulls/83`
							) {
								return Response.json({
									...pullAs(recorded, {
										number: 83,
										body: "Closes WID-2",
										state: "open",
									}),
									auto_merge: null,
								});
							}
							if (url.includes("/pulls?state=closed")) {
								return page([]);
							}
							if (
								url.includes("/comments") ||
								url.includes("/reviews") ||
								url.includes("/reactions")
							) {
								return page([]);
							}
							if (url.includes("/check-runs")) {
								return Response.json({ check_runs: [] });
							}
							if (url.includes("/commits/")) {
								return Response.json({
									commit: { committer: { date: "2026-08-18T11:00:00.000Z" } },
								});
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
							state: item.state,
							lane: item.lane,
						});
						expect(
							needsYouOf(report)
								.filter((row) => row.key === "WID-2")
								.map((row) => row.reason),
						).toEqual([...item.reasons]);
					},
					checkout.root,
				);
			} finally {
				await checkout.cleanup();
			}
		}
	});
});
