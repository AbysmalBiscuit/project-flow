import { describe, expect, test } from "bun:test";

import {
	type OverviewBody,
	projectFetch,
	projectItem,
	projectOf,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("an empty Status places only that ticket by the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(7, "Draw the nodes", {
					name: "In progress",
					color: "YELLOW",
				}),
				projectItem(9, "No status yet", null),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Backlog",
					"Ready",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
				]);
				expect(report.statuses.map((lane) => lane.statusType)).toEqual([
					"backlog",
					"backlog",
					"inProgress",
					"inReview",
					"awaitingMerge",
					"done",
				]);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const placedItem = items.find((item) => item.key === "acme/widget#7");
				const empty = items.find((item) => item.key === "acme/widget#9");
				expect(placedItem?.status ?? placedItem?.lane).toBe("In progress");
				expect(placedItem?.statusType).toBe("inProgress");
				expect(empty?.status ?? empty?.lane).toBe("Backlog");
				expect(empty?.statusType).toBe("backlog");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					overview.projects.find((item) => item.name === "Widget board")
						?.statusTypes,
				).toEqual({
					backlog: 1,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					done: 0,
					dropped: 0,
				});
			},
		);
	});

	test("an empty Status uses a renamed board lane of that status type", async () => {
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
				[
					projectItem(9, "No status yet", null),
					projectItem(8, "Blank status", { name: "   ", color: "GRAY" }),
					projectItem(10, "Shipped without a status", null, {
						state: "CLOSED",
						stateReason: "COMPLETED",
					}),
					projectItem(15, "Closed with no reason", null, {
						state: "CLOSED",
						stateReason: null,
					}),
					projectItem(12, "Dropped without a status", null, {
						state: "CLOSED",
						stateReason: "NOT_PLANNED",
					}),
				],
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
					"Dropped",
				]);
				expect(report.statuses.map((lane) => lane.name)).not.toContain(
					"Backlog",
				);
				expect(report.statuses.map((lane) => lane.name)).not.toContain("Done");
				const sections = report.sections.flatMap(
					(section) => section.items ?? [],
				);
				const open = sections.find((item) => item.key === "acme/widget#9");
				const blank = sections.find((item) => item.key === "acme/widget#8");
				expect(open?.status ?? open?.lane).toBe("Todo");
				expect(open?.statusType).toBe("backlog");
				expect(blank?.status ?? blank?.lane).toBe("Todo");
				expect(blank?.statusType).toBe("backlog");
				expect(
					report.statuses.find((lane) => lane.name === "Dropped")?.added,
				).toBe(true);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const tickets =
					overview.projects.find((item) => item.name === "Widget board")
						?.tickets ?? [];
				const names = new Set(report.statuses.map((lane) => lane.name));
				expect(tickets.find((item) => item.key === "acme/widget#10")).toEqual(
					expect.objectContaining({ status: "Shipped", statusType: "done" }),
				);
				expect(tickets.find((item) => item.key === "acme/widget#15")).toEqual(
					expect.objectContaining({ status: "Shipped", statusType: "done" }),
				);
				expect(tickets.find((item) => item.key === "acme/widget#12")).toEqual(
					expect.objectContaining({ lane: "Dropped", statusType: "dropped" }),
				);
				for (const item of tickets) {
					expect(
						(item.status ?? item.lane) === undefined ||
							names.has(item.status ?? item.lane ?? ""),
					).toBe(true);
				}
			},
		);
	});

	test("an empty Status adds the app lane when the board has no lane of that type", async () => {
		const options = [
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(9, "No status yet", null),
					projectItem(11, "Wait for review", { name: "Review", color: "BLUE" }),
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).toEqual([
					"Backlog",
					"Doing",
					"Review",
					"Awaiting merge",
				]);
				expect(report.statuses.find((lane) => lane.name === "Doing")).toEqual({
					id: "opt-doing",
					name: "Doing",
					colour: "#F2C94C",
					statusType: "inProgress",
				});
				const added = report.statuses.find((lane) => lane.name === "Backlog");
				expect(added?.statusType).toBe("backlog");
				expect(added?.colour).toBe("#8a8680");
				expect(added?.added).toBe(true);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const empty = items.find((item) => item.key === "acme/widget#9");
				const placedItem = items.find((item) => item.key === "acme/widget#11");
				expect(empty?.status ?? empty?.lane).toBe("Backlog");
				expect(empty?.statusType).toBe("backlog");
				expect(placedItem?.status ?? placedItem?.lane).toBe("Review");
				const names = new Set(report.statuses.map((lane) => lane.name));
				for (const item of items) {
					expect(
						(item.status ?? item.lane) === undefined ||
							names.has(item.status ?? item.lane ?? ""),
					).toBe(true);
				}
			},
		);
	});
});
