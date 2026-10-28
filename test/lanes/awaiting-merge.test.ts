import { describe, expect, test } from "bun:test";

import { linearFake } from "../support/linear.ts";
import {
	flight,
	linearIssue,
	linearSlug,
	linearStates,
	linearTeam,
	placed,
	projectFetch,
	projectItem,
	projectOf,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("a Linear started Ready to merge status is awaiting merge", async () => {
		const states = [
			...linearStates,
			{
				id: "st-merge",
				name: "Ready to merge",
				type: "started",
				position: 2037,
				color: "#4CB782",
			},
		];
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
					linearIssue("WID-3", "Land the branch", {
						id: "st-merge",
						name: "Ready to merge",
						type: "started",
						color: "#4CB782",
					}),
				],
				states,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(
					report.statuses.find((lane) => lane.name === "Ready to merge"),
				).toEqual({
					id: "st-merge",
					name: "Ready to merge",
					colour: "#4CB782",
					statusType: "awaitingMerge",
				});
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
					"Ready to merge",
				]);
				expect(flight(report)).toEqual([
					placed("WID-3", "Land the branch", "Ready to merge", "awaitingMerge"),
				]);
			},
		);
	});

	test("a board without a matching status gets Awaiting merge after In Review", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
			{ id: "opt-shipped", name: "Shipped", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[projectItem(11, "Wait for review", { name: "Review", color: "BLUE" })],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Todo",
					"Doing",
					"Review",
					"Awaiting merge",
					"Shipped",
				]);
				const added = report.statuses.find(
					(lane) => lane.name === "Awaiting merge",
				);
				expect(added?.statusType).toBe("awaitingMerge");
				expect(added?.colour).toBe("#1f9d6a");
				expect(added?.added).toBe(true);
			},
		);
	});

	test("a board with no In Review lane inserts Awaiting merge at the awaiting merge position", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-shipped", name: "Shipped", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[projectItem(12, "Still doing", { name: "Doing", color: "YELLOW" })],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Todo",
					"Doing",
					"Awaiting merge",
					"Shipped",
				]);
				const added = report.statuses.find(
					(lane) => lane.name === "Awaiting merge",
				);
				expect(added?.statusType).toBe("awaitingMerge");
				expect(added?.added).toBe(true);
			},
		);
	});

	test("repeated spaces in an awaiting lane name skip the added lane", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
			{ id: "opt-awaiting", name: "Awaiting  merge", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(15, "Wait for merge", {
						name: "Awaiting  merge",
						color: "GREEN",
					}),
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(
					report.statuses.filter((lane) => lane.statusType === "awaitingMerge"),
				).toEqual([
					{
						id: "opt-awaiting",
						name: "Awaiting  merge",
						colour: "#4CB782",
						statusType: "awaitingMerge",
					},
				]);
				expect(flight(report)[0]?.lane).toBe("Awaiting  merge");
			},
		);
	});
});
