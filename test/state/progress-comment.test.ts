import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import factoryLabels from "../fixtures/github-factory-labels.json";
import { repo as githubRepo } from "../support/github.ts";
import {
	devkitWorktree,
	fixtureDir,
	git,
	githubIssue,
	linearIssue,
	linearSlug,
	needsYouOf,
	progress,
	projectOf,
	recordedLinear,
	recordedRepo,
	ticketOf,
	todoState,
	withApp,
} from "./_support.ts";

describe("forward state", () => {
	test("a ticket whose only run evidence is a workcell progress comment shows as a live run with its stage", async () => {
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
								body: progress("- stage 1: implementing the live-run read"),
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
					run: { status: "running", stage: "stage 1" },
				});
			},
		);
	});

	test("a stage line then a report comment with no final report line keeps the live run", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-21", "Report without a resume", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 3: receive"),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
							{
								id: "c2",
								body: "Notes from the round.\n\n<!-- workcell:report -->",
								createdAt: "2026-08-18T13:05:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-23", "Blank report comment", todoState, {
					comments: {
						nodes: [
							{
								id: "c3",
								body: progress("- stage 2: implementing"),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
							{
								id: "c4",
								body: "   \n\n<!-- workcell:report -->",
								createdAt: "2026-08-18T13:05:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-24", "Report and no stage line", todoState, {
					comments: {
						nodes: [
							{
								id: "c5",
								body: progress("- waiting on the review"),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
							{
								id: "c6",
								body: "Notes.\n\n<!-- workcell:report -->",
								createdAt: "2026-08-18T13:05:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-21")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					staleStatus: "Todo",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 3" },
				});
				expect(ticketOf(report, "WID-23")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					run: { status: "running", stage: "stage 2" },
				});
				expect(ticketOf(report, "WID-24")).toMatchObject({
					state: "backlog",
					status: "Todo",
				});
				expect(ticketOf(report, "WID-24").run).toBeUndefined();
			},
		);
	});

	test("an answered ask after the final report keeps the ticket a live run", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-17", "Answer the ask", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress(
									"- stage 5: round 1 of 2\n- final report sent\n- ask-1 answered: ship it",
								),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
							{
								id: "c2",
								body: "Final report. 1 row left.\n\n<!-- workcell:report -->\n\n<!-- workcell:ask 17-1 -->",
								createdAt: "2026-08-18T13:05:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-17")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					staleStatus: "Todo",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 5" },
				});
			},
		);
	});

	test("a finished progress comment shows its last stage and a blank progress line invents no run", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-11", "Already reported", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 5: round 1 of 2\n- final report sent"),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-12", "Blank progress", todoState, {
					comments: {
						nodes: [
							{
								id: "c2",
								body: progress("- \n-   "),
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
				expect(ticketOf(report, "WID-11")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					staleStatus: "Todo",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 5" },
				});
				expect(ticketOf(report, "WID-12")).toMatchObject({
					state: "backlog",
					status: "Todo",
				});
				expect(ticketOf(report, "WID-12").run).toBeUndefined();
			},
		);
	});

	test("a GitHub ticket whose only run evidence is a workcell progress comment shows as a live run with its stage", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[githubIssue(14, { title: "Ship the list", comments: 1 })],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				[],
				[],
				[],
				[
					{
						id: 14,
						body: progress("- stage 3: receive"),
						user: { login: "lev" },
						created_at: "2026-08-18T13:00:00Z",
					},
				],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#14`)).toMatchObject({
					state: "inProgress",
					lane: "In progress",
					statusType: "inProgress",
					run: { status: "running", stage: "stage 3" },
				});
			},
			undefined,
			new Date("2026-08-18T14:00:00.000Z"),
		);
	});

	test("a GitHub ticket whose only run evidence is an old progress comment shows the run as stalled", async () => {
		const now = new Date("2026-08-18T14:00:00.000Z");
		const old = "2026-08-18T11:59:00.000Z";
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[githubIssue(27, { title: "The run stopped", comments: 1 })],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				[],
				[],
				factoryLabels,
				[
					{
						id: 27,
						body: progress("- stage 4: opening the PR"),
						user: { login: "lev" },
						created_at: "2026-08-18T10:00:00Z",
						updated_at: old,
					},
				],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#27`)).toMatchObject({
					state: "backlog",
					status: "ready",
					chips: ["Run failed"],
					run: { status: "failed", stage: "stage 4" },
				});
				expect(
					needsYouOf(report)
						.filter((row) => row.key === `${githubRepo}#27`)
						.map((row) => row.reason),
				).toEqual(["runFailed"]);
			},
			undefined,
			now,
		);
	});

	test("a finished progress comment older than the stall limit shows no failed run", async () => {
		const now = new Date("2026-08-18T14:00:00.000Z");
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-30", "Already reported", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 5: round 1 of 2\n- final report sent"),
								createdAt: "2026-08-18T10:00:00.000Z",
								updatedAt: "2026-08-18T10:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				const ticket = ticketOf(report, "WID-30");
				expect(ticket).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					run: { status: "running", stage: "stage 5" },
				});
				expect(ticket.chips ?? []).not.toContain("Run failed");
			},
			undefined,
			now,
		);
	});

	test("a ticket whose only run evidence is a progress comment older than the stall limit shows the run as stalled", async () => {
		const now = new Date("2026-08-18T14:00:00.000Z");
		const fresh = "2026-08-18T12:01:00.000Z";
		const old = "2026-08-18T11:59:00.000Z";
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-27", "The run stopped", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 2: implementing"),
								createdAt: "2026-08-18T10:00:00.000Z",
								updatedAt: old,
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-28", "The run is live", todoState, {
					comments: {
						nodes: [
							{
								id: "c2",
								body: progress("- stage 1: implementing"),
								createdAt: "2026-08-18T10:00:00.000Z",
								updatedAt: fresh,
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-29", "No updated time", todoState, {
					comments: {
						nodes: [
							{
								id: "c3",
								body: progress("- stage 3: receive"),
								createdAt: old,
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-27")).toMatchObject({
					state: "backlog",
					status: "Todo",
					chips: ["Run failed"],
					run: { status: "failed", stage: "stage 2" },
				});
				expect(
					needsYouOf(report)
						.filter((row) => row.key === "WID-27")
						.map((row) => row.reason),
				).toEqual(["runFailed"]);
				expect(ticketOf(report, "WID-28")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					staleStatus: "Todo",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 1" },
				});
				expect(
					needsYouOf(report).filter((row) => row.key === "WID-28"),
				).toEqual([]);
				const blank = ticketOf(report, "WID-29");
				expect(blank).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					run: { status: "running", stage: "stage 3" },
				});
				expect(blank.chips ?? []).not.toContain("Run failed");
			},
			undefined,
			now,
		);
	});

	test("a progress comment at the stall limit stays running and a blank update invents no stall", async () => {
		const now = new Date("2026-08-18T14:00:00.000Z");
		const boundary = "2026-08-18T12:00:00.000Z";
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-32", "Edited at the limit", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 1: implementing"),
								createdAt: "2026-08-18T10:00:00.000Z",
								updatedAt: boundary,
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-33", "Blank update", todoState, {
					comments: {
						nodes: [
							{
								id: "c2",
								body: progress("- stage 2: implementing"),
								createdAt: boundary,
								updatedAt: "   ",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				for (const key of ["WID-32", "WID-33"]) {
					const ticket = ticketOf(report, key);
					expect(ticket.run?.status).toBe("running");
					expect(ticket.chips ?? []).not.toContain("Run failed");
				}
			},
			undefined,
			now,
		);
	});

	test("a stage line that says failed or stalled stays a live run with its stage", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-13", "The run failed", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage 2: the run failed"),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-15", "The run stalled", todoState, {
					comments: {
						nodes: [
							{
								id: "c2",
								body: progress("- stage 3: stalled on the review"),
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
				expect(ticketOf(report, "WID-13")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					staleStatus: "Todo",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 2" },
				});
				expect(
					needsYouOf(report).filter((row) => row.key === "WID-13"),
				).toEqual([]);
				expect(ticketOf(report, "WID-15")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 3" },
				});
				expect(
					needsYouOf(report).filter((row) => row.key === "WID-15"),
				).toEqual([]);
			},
		);
	});

	test("a local failed run and a progress comment show one merged run", async () => {
		const checkout = await devkitWorktree({ key: "WID-16", status: "failed" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-16", "Retry the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 4: opening the PR"),
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
					expect(ticketOf(report, "WID-16")).toMatchObject({
						state: "backlog",
						status: "Todo",
						statusType: "backlog",
						chips: ["Run failed"],
						run: { status: "failed", stage: "stage 4" },
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === "WID-16")
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a local live run with no progress comment omits the stage", async () => {
		const checkout = await devkitWorktree({ key: "WID-22", status: "running" });
		const main = join(checkout.root, "acme", "widget");
		const failedTree = join(
			checkout.root,
			"acme",
			"widget_workspaces",
			"WID-25-feat",
		);
		await git(["worktree", "add", "-b", "failed-run", failedTree], main);
		const issue = await readFile(join(fixtureDir, "issue.toml"), "utf8");
		await mkdir(join(failedTree, ".devkit", "workcell"), { recursive: true });
		await writeFile(
			join(failedTree, ".devkit", "issue.toml"),
			issue.replace(/^issue = ".*"$/m, 'issue = "WID-25"'),
		);
		await writeFile(
			join(failedTree, ".devkit", "workcell", "state.json"),
			await readFile(join(fixtureDir, "state-failed.json")),
		);
		const blankTree = join(
			checkout.root,
			"acme",
			"widget_workspaces",
			"WID-26-feat",
		);
		await git(["worktree", "add", "-b", "blank-run", blankTree], main);
		await mkdir(join(blankTree, ".devkit", "workcell"), { recursive: true });
		await writeFile(
			join(blankTree, ".devkit", "issue.toml"),
			issue.replace(/^issue = ".*"$/m, 'issue = "WID-26"'),
		);
		await writeFile(
			join(blankTree, ".devkit", "workcell", "state.json"),
			"   \n",
		);
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-22", "Ship the list", todoState),
					linearIssue("WID-25", "The run failed", todoState),
					linearIssue("WID-26", "Blank state file", todoState),
				]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-22")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
						staleStatus: "Todo",
						run: { status: "running" },
					});
					expect(ticketOf(report, "WID-22").run).not.toHaveProperty("stage");
					expect(ticketOf(report, "WID-25")).toMatchObject({
						state: "backlog",
						status: "Todo",
						chips: ["Run failed"],
						run: { status: "failed" },
					});
					expect(ticketOf(report, "WID-25").run).not.toHaveProperty("stage");
					expect(ticketOf(report, "WID-26")).toMatchObject({
						state: "backlog",
						status: "Todo",
					});
					expect(ticketOf(report, "WID-26").run).toBeUndefined();
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a local live run keeps the stage from the progress comment", async () => {
		const checkout = await devkitWorktree({ key: "WID-14", status: "running" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-14", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 4: opening the PR"),
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
					expect(ticketOf(report, "WID-14")).toMatchObject({
						state: "inProgress",
						status: "In Progress",
						staleStatus: "Todo",
						run: { status: "running", stage: "stage 4" },
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a blank stage, repeated spaces and a failed word outside a stage line invent no failed run", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
			}),
			recordedLinear([
				linearIssue("WID-19", "Blank stage", todoState, {
					comments: {
						nodes: [
							{
								id: "c1",
								body: progress("- stage    \n-   "),
								createdAt: "2026-08-18T13:00:00.000Z",
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				}),
				linearIssue("WID-20", "Failed outside the stage", todoState, {
					comments: {
						nodes: [
							{
								id: "c2",
								body: progress(
									"- the fetch failed\n- stage 2:   opening the PR",
								),
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
				expect(ticketOf(report, "WID-19").run).toBeUndefined();
				expect(
					needsYouOf(report).filter((row) => row.key === "WID-19"),
				).toEqual([]);
				expect(ticketOf(report, "WID-20")).toMatchObject({
					state: "inProgress",
					status: "In Progress",
					chips: ["Todo"],
					run: { status: "running", stage: "stage 2" },
				});
			},
		);
	});

	test("a blank workcell status and repeated spaces do not invent a live run", async () => {
		const checkout = await devkitWorktree({ key: "WID-1", status: "running" });
		const statePath = join(
			checkout.root,
			"acme",
			"widget_workspaces",
			"WID-1-feat",
			".devkit",
			"workcell",
			"state.json",
		);
		await writeFile(statePath, JSON.stringify({ status: "  running  " }));
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([linearIssue("WID-1", "Ship the list", todoState)]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-1")).toMatchObject({
						state: "backlog",
						status: "Todo",
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});
});
