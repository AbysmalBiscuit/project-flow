import { describe, expect, test } from "bun:test";

import factoryLabels from "../fixtures/github-factory-labels.json";
import historyNode from "../fixtures/linear-history-node.json";
import { urlOf } from "../support/fetch.ts";
import { page, repo as githubRepo } from "../support/github.ts";
import {
	boardFetch,
	boardItem,
	githubIssue,
	linearIssue,
	linearSlug,
	progressState,
	projectOf,
	recordedJson,
	recordedLinear,
	recordedRepo,
	ticketOf,
	todoState,
	withApp,
} from "./_support.ts";

describe("forward state", () => {
	test("a ticket carries the time it entered its state, from tracker history or its last update", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear([
				linearIssue("WID-7", "Moved yesterday", progressState, {
					history: {
						nodes: [
							{
								...historyNode,
								createdAt: "2026-08-17T09:00:00.000Z",
								toState: { id: todoState.id, name: "Todo", type: "unstarted" },
							},
							historyNode,
						],
					},
				}),
				linearIssue("WID-8", "Never moved", todoState),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-7").enteredStateAt).toBe(
					historyNode.createdAt,
				);
				expect(ticketOf(report, "WID-8").enteredStateAt).toBe(
					"2026-08-18T12:00:00.000Z",
				);
			},
		);
	});

	test("an empty repo poll skips the issue event feed", async () => {
		const requests: string[] = [];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				requests,
				[],
				factoryLabels,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				await projectOf(base, githubRepo);
				expect(
					requests.filter((item) => item.includes("/issues/events")),
				).toEqual([]);
			},
		);
	});

	test("the issue event feed stops at the oldest ticket update", async () => {
		const recorded = (await recordedJson(
			"github-issue-events-stop.json",
		)) as Record<string, unknown>[];
		const newer = recorded[0];
		const older = recorded[1];
		const enteredAt = String(newer?.created_at);
		const olderAt = String(older?.created_at);
		const editedAt = "2026-10-19T17:05:00Z";
		const requests: string[] = [];
		const first = `https://api.github.com/repos/${githubRepo}/issues/events?per_page=100&page=1`;
		const second = `https://api.github.com/repos/${githubRepo}/issues/events?per_page=100&page=2`;
		const third = `https://api.github.com/repos/${githubRepo}/issues/events?per_page=100&page=3`;
		const forTicket = (event: Record<string, unknown> | undefined) => ({
			...event,
			issue: { number: 8 },
			label: { name: "factory: running" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				if (url === first) {
					requests.push(url);
					return new Response(JSON.stringify([forTicket(newer)]), {
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${second}>; rel="next"`,
						},
					});
				}
				if (url === second) {
					requests.push(url);
					return new Response(JSON.stringify([forTicket(older)]), {
						status: 200,
						headers: {
							"content-type": "application/json",
							link: `<${third}>; rel="next"`,
						},
					});
				}
				if (
					url.startsWith(
						`https://api.github.com/repos/${githubRepo}/issues/events?`,
					)
				) {
					requests.push(url);
					return page([]);
				}
				return recordedRepo(
					[
						githubIssue(8, {
							title: "Edited after its label",
							updated_at: editedAt,
							labels: [{ name: "factory: running" }],
						}),
					],
					[],
					[],
					{ allow_auto_merge: false },
					[],
					requests,
					[],
					factoryLabels,
				)(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					status: "factory: running",
					enteredStateAt: enteredAt,
				});
				expect(olderAt < editedAt).toBe(true);
				expect(requests.filter((item) => item === second)).toEqual([second]);
				expect(requests.filter((item) => item === third)).toEqual([]);
				expect(
					requests.filter((item) => item.includes("/issues/8/events")),
				).toEqual([]);
			},
		);
	});

	test("the issue event feed stops at a fixed page bound", async () => {
		const requests: string[] = [];
		const eventUrl = (page: number) =>
			`https://api.github.com/repos/${githubRepo}/issues/events?per_page=100&page=${page}`;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				const match = url.match(/\/issues\/events\?.*page=(\d+)/);
				if (match !== null) {
					requests.push(url);
					const page = Number(match[1]);
					return new Response(
						JSON.stringify([
							{
								event: "labeled",
								created_at: "2026-10-20T09:40:21Z",
								issue: { number: 8 },
								label: { name: "factory: running" },
							},
						]),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
								link: `<${eventUrl(page + 1)}>; rel="next"`,
							},
						},
					);
				}
				return recordedRepo(
					[
						githubIssue(8, {
							updated_at: "2026-10-18T15:04:15Z",
							labels: [{ name: "factory: running" }],
						}),
					],
					[],
					[],
					{ allow_auto_merge: false },
					[],
					requests,
					[],
					factoryLabels,
				)(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				await projectOf(base, githubRepo);
				expect(requests.filter((item) => item === eventUrl(10))).toEqual([
					eventUrl(10),
				]);
				expect(requests.filter((item) => item === eventUrl(11))).toEqual([]);
			},
		);
	});

	test("a GitHub ticket with no tracker history uses its last update", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo([
				githubIssue(8, { updated_at: "2026-08-18T12:00:00.000Z" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`).enteredStateAt).toBe(
					"2026-08-18T12:00:00.000Z",
				);
			},
		);
	});

	test("a repo-board ticket keeps the time it entered its state", async () => {
		const enteredAt = "2026-10-19T17:05:53Z";
		const editedAt = "2026-10-20T09:40:21Z";
		const closedAt = "2026-10-20T09:36:26Z";
		const requests: string[] = [];
		const events = (await recordedJson("github-issue-events.json")) as Record<
			string,
			unknown
		>[];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(8, {
						title: "Edited after its label",
						updated_at: editedAt,
						labels: [{ name: "factory: running" }],
					}),
					githubIssue(9, {
						title: "Closed after a later edit",
						state: "closed",
						state_reason: "completed",
						updated_at: editedAt,
						closed_at: closedAt,
						labels: [{ name: "ready" }],
					}),
					githubIssue(10, {
						title: "No label events",
						updated_at: editedAt,
						labels: [{ name: "factory: in-review" }],
					}),
					githubIssue(11, {
						title: "No event for its status label",
						updated_at: editedAt,
						labels: [{ name: "factory: running" }],
					}),
				],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				requests,
				events,
				factoryLabels,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					status: "factory: running",
					statusType: "inProgress",
					enteredStateAt: enteredAt,
				});
				expect(ticketOf(report, `${githubRepo}#9`)).toMatchObject({
					lane: "Done",
					statusType: "done",
					enteredStateAt: closedAt,
				});
				expect(ticketOf(report, `${githubRepo}#10`).enteredStateAt).toBe(
					editedAt,
				);
				expect(ticketOf(report, `${githubRepo}#11`).enteredStateAt).toBe(
					editedAt,
				);
				expect(
					requests.filter((item) => item.includes("/issues/8/timeline")),
				).toEqual([]);
				expect(
					requests.filter((item) => item.includes("/issues/8/events")),
				).toEqual([]);
			},
		);
	});

	test("a missing issue events page keeps the issue edit time", async () => {
		const editedAt = "2026-08-18T15:00:00Z";
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				if (url.includes("/issues/events?")) {
					return new Response("missing", { status: 404 });
				}
				return recordedRepo(
					[
						githubIssue(8, {
							title: "No events page",
							updated_at: editedAt,
							labels: [{ name: "factory: running" }],
						}),
					],
					[],
					[],
					{ allow_auto_merge: false },
					[],
					[],
					[],
					factoryLabels,
				)(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					status: "factory: running",
					enteredStateAt: editedAt,
				});
			},
		);
	});

	test("a reopened ticket with its factory label still attached enters at the reopen", async () => {
		const labeledAt = "2026-10-18T15:11:19Z";
		const reopenedAt = "2026-10-19T02:52:21Z";
		const editedAt = "2026-10-20T09:40:21Z";
		const events = (await recordedJson("github-issue-reopened.json")) as Record<
			string,
			unknown
		>[];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(13, {
						title: "Reopened with the label still attached",
						state: "open",
						state_reason: "reopened",
						updated_at: editedAt,
						labels: [{ name: "factory: running" }],
					}),
				],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				[],
				events,
				factoryLabels,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				const ticket = ticketOf(report, `${githubRepo}#13`);
				expect(ticket).toMatchObject({
					status: "factory: running",
					statusType: "inProgress",
					enteredStateAt: reopenedAt,
				});
				expect(ticket.enteredStateAt).not.toBe(labeledAt);
				expect(ticket.enteredStateAt).not.toBe(editedAt);
			},
		);
	});

	test("a repo with no factory labels keeps its close time", async () => {
		const createdAt = "2026-10-18T15:11:18Z";
		const closedAt = "2026-10-20T09:36:26Z";
		const editedAt = "2026-08-18T15:00:00Z";
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(9, {
						title: "Closed after a later edit",
						state: "closed",
						state_reason: "completed",
						created_at: "2026-10-19T17:03:32Z",
						updated_at: "2026-10-20T09:38:20Z",
						closed_at: "2026-10-20T09:36:26Z",
					}),
					githubIssue(8, {
						title: "Open with no lanes",
						created_at: createdAt,
						updated_at: editedAt,
					}),
				],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				[],
				[],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#9`)).toMatchObject({
					lane: "Done",
					statusType: "done",
					enteredStateAt: closedAt,
				});
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					lane: "Backlog",
					enteredStateAt: createdAt,
				});
			},
		);
	});

	test("an unlabelled ticket enters Backlog at its created time", async () => {
		const createdAt = "2026-10-18T15:11:18Z";
		const editedAt = "2026-08-18T15:00:00Z";
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(8, {
						title: "No status label",
						created_at: createdAt,
						updated_at: editedAt,
					}),
				],
				[],
				[],
				{ allow_auto_merge: false },
				[],
				[],
				[],
				factoryLabels,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					status: "ready",
					statusType: "backlog",
					enteredStateAt: createdAt,
				});
			},
		);
	});

	test("a GitHub ticket edited after its last status change keeps that change time", async () => {
		const statusChangedAt = "2026-08-17T09:00:00Z";
		const editedAt = "2026-08-18T15:00:00Z";
		const requests: string[] = [];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			boardFetch(
				[
					boardItem(
						8,
						"Draw the nodes",
						{ name: "In progress", color: "YELLOW" },
						{ updatedAt: statusChangedAt },
						{ updatedAt: editedAt },
					),
					boardItem(
						9,
						"Blank status time",
						{ name: "In progress", color: "YELLOW" },
						{ updatedAt: "   " },
						{ updatedAt: editedAt },
					),
					boardItem(
						10,
						"Missing status time",
						{ name: "Backlog", color: "GREEN" },
						{},
						{ updatedAt: editedAt },
					),
				],
				[],
				requests,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(ticketOf(report, `${githubRepo}#8`).enteredStateAt).toBe(
					statusChangedAt,
				);
				expect(ticketOf(report, `${githubRepo}#9`).enteredStateAt).toBe(
					editedAt,
				);
				expect(ticketOf(report, `${githubRepo}#10`).enteredStateAt).toBe(
					editedAt,
				);
				expect(
					requests.filter((body) => body.includes("/issues/8/timeline")),
				).toEqual([]);
				expect(
					requests.filter((body) => body.includes("timelineItems")),
				).toEqual([]);
			},
		);
	});

	test("a retired status option keeps the field time as enteredStateAt", async () => {
		const fieldUpdatedAt = "2026-08-17T09:00:00Z";
		const editedAt = "2026-08-18T15:00:00Z";
		const requests: string[] = [];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			boardFetch(
				[
					boardItem(
						11,
						"Retired progress name",
						{ name: "Doing", color: "YELLOW" },
						{ updatedAt: fieldUpdatedAt, optionId: "opt-retired-progress" },
						{ updatedAt: editedAt },
					),
					boardItem(
						12,
						"Blank option id",
						{ name: "Doing", color: "YELLOW" },
						{ updatedAt: fieldUpdatedAt, optionId: "" },
						{ updatedAt: editedAt },
					),
					boardItem(
						13,
						"Spaced field time",
						{ name: "Doing", color: "YELLOW" },
						{
							updatedAt: "   ",
							optionId: "opt-retired-progress",
						},
						{ updatedAt: editedAt },
					),
				],
				[],
				requests,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(ticketOf(report, `${githubRepo}#11`)).toMatchObject({
					lane: "In progress",
					statusType: "inProgress",
					enteredStateAt: fieldUpdatedAt,
				});
				expect(ticketOf(report, `${githubRepo}#12`)).toMatchObject({
					lane: "Backlog",
					enteredStateAt: editedAt,
				});
				expect(ticketOf(report, `${githubRepo}#13`).enteredStateAt).toBe(
					editedAt,
				);
				expect(
					requests.filter((body) => body.includes("/issues/11/timeline")),
				).toEqual([]);
			},
		);
	});
});
