import { describe, expect, test } from "bun:test";

import { urlOf } from "../support/fetch.ts";
import { page, repo as githubRepo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { repoReadFromHandler } from "../support/repo-read.ts";
import {
	expectLanesHoldTickets,
	flight,
	githubIssue,
	linearIssue,
	linearSlug,
	linearStates,
	linearTeam,
	type OverviewBody,
	placed,
	plainRepo,
	projectFetch,
	projectItem,
	projectOf,
	recordedFactoryLabelPage,
	repoFetch,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("a Linear team returns its workflow statuses as lanes", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
					teams: { nodes: [linearTeam] },
				},
				issues: [
					linearIssue("WID-1", "Ship the list", {
						id: "cce36b04-d482-4233-b1d8-33eda76ca025",
						name: "In Progress",
						type: "started",
						color: "#f2c94c",
					}),
					linearIssue("WID-2", "Write the notes", {
						id: "364b3510-9325-4af6-9df1-8f2ff56f7a3d",
						name: "Todo",
						type: "unstarted",
						color: "#e2e2e2",
					}),
				],
				states: linearStates,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Triage",
					"In Progress",
					"Backlog",
					"Todo",
					"Done",
					"Canceled",
					"Duplicate",
					"Waiting To Progress",
					"In Review",
					"Awaiting merge",
				]);
				expect(
					report.statuses.find((lane) => lane.name === "In Review"),
				).toEqual({
					id: "558ba933-745c-42e2-8969-b3757c54bd5c",
					name: "In Review",
					colour: "#4cb782",
					statusType: "inReview",
				});
				expect(
					report.statuses.find((lane) => lane.name === "Done")?.statusType,
				).toBe("done");
				expect(
					report.statuses.find((lane) => lane.name === "Canceled")?.statusType,
				).toBe("dropped");
				expect(
					report.statuses.find((lane) => lane.name === "Duplicate")?.statusType,
				).toBe("dropped");
				expect(
					report.statuses.find((lane) => lane.name === "Triage")?.colour,
				).toBe("#FC7840");
				expect(flight(report)).toEqual([
					placed("WID-1", "Ship the list", "In Progress", "inProgress"),
					placed("WID-2", "Write the notes", "Todo", "backlog"),
				]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expectLanesHoldTickets(report, overview, "Widget launch");
			},
		);
	});

	test("a GitHub project returns its Status options as lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(7, "Draw the nodes", {
					name: "In progress",
					color: "YELLOW",
				}),
				projectItem(8, "Write the copy", { name: "Backlog", color: "GREEN" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(
					report.statuses.map((lane) => [
						lane.name,
						lane.colour,
						lane.statusType,
					]),
				).toEqual([
					["Backlog", "#4CB782", "backlog"],
					["Ready", "#4C9AFF", "backlog"],
					["In progress", "#F2C94C", "inProgress"],
					["In review", "#5E6AD2", "inReview"],
					["Awaiting merge", "#1f9d6a", "awaitingMerge"],
					["Done", "#F2994A", "done"],
				]);
				expect(flight(report)).toEqual([
					placed(
						"acme/widget#7",
						"Draw the nodes",
						"In progress",
						"inProgress",
					),
					placed("acme/widget#8", "Write the copy", "Backlog", "backlog"),
				]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expectLanesHoldTickets(report, overview, "Widget board");
			},
		);
	});

	test("a repo with factory labels uses those labels as lanes", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("query RepoRead")
				) {
					const answered = await repoReadFromHandler(
						input,
						init,
						async (restInput) => {
							const restUrl = urlOf(restInput);
							if (restUrl.includes("/labels?")) {
								return recordedFactoryLabelPage();
							}
							if (restUrl.includes("/issues?")) {
								return page([
									githubIssue(1, "Queue the job", githubRepo, {
										labels: [{ name: "ready" }],
									}),
									githubIssue(2, "Run the job", githubRepo, {
										labels: [{ name: "factory: running" }],
									}),
									githubIssue(3, "Review the job", githubRepo, {
										labels: [{ name: "factory: in-review" }],
									}),
									githubIssue(4, "Ship the job", githubRepo, {
										state: "closed",
										state_reason: "completed",
										labels: [{ name: "ready" }],
									}),
									githubIssue(5, "Drop the job", githubRepo, {
										state: "closed",
										state_reason: "not_planned",
									}),
								]);
							}
							return page([]);
						},
					);
					return answered ?? recordedFactoryLabelPage();
				}
				if (
					url.startsWith(`https://api.github.com/repos/${githubRepo}/labels?`)
				) {
					return recordedFactoryLabelPage();
				}
				return repoFetch({
					[githubRepo]: [
						githubIssue(1, "Queue the job", githubRepo, {
							labels: [{ name: "ready" }],
						}),
						githubIssue(2, "Run the job", githubRepo, {
							labels: [{ name: "factory: running" }],
						}),
						githubIssue(3, "Review the job", githubRepo, {
							labels: [{ name: "factory: in-review" }],
						}),
						githubIssue(4, "Ship the job", githubRepo, {
							state: "closed",
							state_reason: "completed",
							labels: [{ name: "ready" }],
						}),
						githubIssue(5, "Drop the job", githubRepo, {
							state: "closed",
							state_reason: "not_planned",
						}),
					],
				})(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(
					report.statuses.map((lane) => [
						lane.name,
						lane.colour,
						lane.statusType,
					]),
				).toEqual([
					["ready", "#0E8A16", "backlog"],
					["factory: running", "#1D76DB", "inProgress"],
					["factory: in-review", "#FBCA04", "inReview"],
					["Awaiting merge", "#1f9d6a", "awaitingMerge"],
					["Done", "#7c5cbf", "done"],
					["Dropped", "#9ca3af", "dropped"],
				]);
				expect(
					report.statuses.find((lane) => lane.name === "Done")?.added,
				).toBe(true);
				expect(
					report.statuses.find((lane) => lane.name === "Dropped")?.added,
				).toBe(true);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expectLanesHoldTickets(report, overview, githubRepo);
				expect(
					flight(report)
						.map((item) => [
							item.key,
							item.status ?? item.lane,
							item.statusType,
						])
						.toSorted((left, right) =>
							(left[0] ?? "").localeCompare(right[0] ?? ""),
						),
				).toEqual([
					["acme/widget#1", "ready", "backlog"],
					["acme/widget#2", "factory: running", "inProgress"],
					["acme/widget#3", "factory: in-review", "inReview"],
				]);
			},
		);
	});

	test("a repo without factory labels uses the app lanes", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: plainRepo }] }),
			repoFetch({
				[plainRepo]: [githubIssue(1, "Write the notes", plainRepo)],
			}),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, plainRepo);
				expect(
					report.statuses.map((lane) => [
						lane.name,
						lane.colour,
						lane.statusType,
					]),
				).toEqual([
					["Backlog", "#8a8680", "backlog"],
					["In progress", "#3b6fd8", "inProgress"],
					["In review", "#e07a2f", "inReview"],
					["Awaiting merge", "#1f9d6a", "awaitingMerge"],
					["Done", "#7c5cbf", "done"],
					["Dropped", "#9ca3af", "dropped"],
				]);
				expect(flight(report)).toEqual([
					placed("acme/plain#1", "Write the notes", "Backlog", "backlog"),
				]);
			},
		);
	});

	test("a GitHub project with no Status options uses the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([projectItem(9, "No status yet", null)], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Backlog",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				]);
				const ticket = report.sections
					.flatMap((section) => section.items ?? [])
					.find((item) => item.key === "acme/widget#9");
				expect(ticket?.state).toBe("backlog");
				expect(report.statuses[0]?.name).toBe("Backlog");
			},
		);
	});

	test("a blocked ticket in a tracker lane stays in that lane", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				{
					...projectItem(21, "Wait on the gate", {
						name: "In progress",
						color: "YELLOW",
					}),
					content: {
						...(projectItem(21, "Wait on the gate", {
							name: "In progress",
							color: "YELLOW",
						}).content as Record<string, unknown>),
						body: "Blocked by: acme/widget#8",
					},
				},
				projectItem(8, "The gate", { name: "Backlog", color: "GREEN" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				const items = report.sections.flatMap((section) => section.items ?? []);
				const waiting = items.find((item) => item.key === "acme/widget#21");
				expect(waiting?.status ?? waiting?.lane).toBe("In progress");
				expect(waiting?.statusType).toBe("inProgress");
				expect(waiting?.state).toBe("inProgress");
				expect(waiting?.blocked).toBe(true);
				const flightKeys = report.sections
					.find((section) => section.id === "inFlight")
					?.items?.map((item) => item.key);
				expect(flightKeys).toEqual(["acme/widget#21"]);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const card = overview.projects.find(
					(item) => item.name === "Widget board",
				);
				expect(card?.blocked).toBe(1);
				expect(card?.inProgress).toBe(1);
				expect(card?.statusTypes?.inProgress).toBe(1);
			},
		);
	});
});
