import { describe, expect, test } from "bun:test";

import { linearFake } from "../support/linear.ts";
import {
	expectLanesHoldTickets,
	flight,
	linearIssue,
	linearSlug,
	linearStates,
	linearTeam,
	type OverviewBody,
	projectFetch,
	projectItem,
	projectOf,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("an unknown Linear status uses the first board lane of that status type", async () => {
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
					linearIssue("WID-30", "Old progress name", {
						id: "st-building",
						name: "Building",
						type: "started",
						color: "#F2994A",
					}),
					linearIssue("WID-31", "Old backlog name", {
						id: "st-icebox",
						name: "Icebox",
						type: "backlog",
						color: "#BEC2C8",
					}),
				],
				states: linearStates,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const tickets =
					overview.projects.find((item) => item.name === "Widget launch")
						?.tickets ?? [];
				expect(tickets.find((item) => item.key === "WID-30")).toEqual(
					expect.objectContaining({
						status: "In Progress",
						statusType: "inProgress",
					}),
				);
				expect(tickets.find((item) => item.key === "WID-31")).toEqual(
					expect.objectContaining({ status: "Triage", statusType: "backlog" }),
				);
				expect(report.statuses.map((lane) => lane.name)).not.toContain(
					"Building",
				);
				expect(report.statuses.map((lane) => lane.name)).not.toContain(
					"Icebox",
				);
				expectLanesHoldTickets(report, overview, "Widget launch");
			},
		);
	});

	test("an unknown status uses the first board lane of that status type", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-ready", name: "Ready", color: "PURPLE" },
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					{
						...projectItem(14, "Retired backlog name", null),
						fieldValueByName: {
							name: "Icebox",
							optionId: "opt-retired-backlog",
							color: "GRAY",
						},
					},
					{
						...projectItem(18, "Retired progress name", null),
						fieldValueByName: {
							name: "In Progress",
							optionId: "opt-retired-progress",
							color: "YELLOW",
						},
					},
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Todo",
					"Ready",
					"Doing",
					"Review",
					"Awaiting merge",
				]);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const icebox = items.find((item) => item.key === "acme/widget#14");
				const building = items.find((item) => item.key === "acme/widget#18");
				expect(icebox?.status ?? icebox?.lane).toBe("Todo");
				expect(icebox?.statusType).toBe("backlog");
				expect(building?.status ?? building?.lane).toBe("Doing");
				expect(building?.statusType).toBe("inProgress");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expectLanesHoldTickets(report, overview, "Widget board");
			},
		);
	});

	test("an unknown status adds the app lane when the board has none of that type", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					{
						...projectItem(20, "Retired progress name", null),
						fieldValueByName: {
							name: "In Progress",
							optionId: "opt-retired-progress",
							color: "YELLOW",
						},
					},
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Todo",
					"In progress",
					"Review",
					"Awaiting merge",
				]);
				const added = report.statuses.find(
					(lane) => lane.name === "In progress",
				);
				expect(added?.statusType).toBe("inProgress");
				expect(added?.colour).toBe("#3b6fd8");
				expect(added?.added).toBe(true);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const building = items.find((item) => item.key === "acme/widget#20");
				expect(building?.status ?? building?.lane).toBe("In progress");
				expect(building?.statusType).toBe("inProgress");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expectLanesHoldTickets(report, overview, "Widget board");
			},
		);
	});

	test("a repeated-space status name matches its option", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(13, "Spaced status", {
					name: "In  review",
					color: "PURPLE",
				}),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(flight(report)[0]?.lane).toBe("In review");
				expect(flight(report)[0]?.statusType).toBe("inReview");
			},
		);
	});
});
