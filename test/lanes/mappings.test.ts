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
	test("a lane mapping override maps evidence to a named status", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
				laneMappings: {
					[linearTeam.key]: { awaitingMerge: "Approved" },
				},
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
					teams: { nodes: [linearTeam] },
				},
				issues: [
					linearIssue("WID-9", "Wait for the merge", {
						id: "st-approved",
						name: "Approved",
						type: "started",
						color: "#BB87FC",
					}),
				],
				states: [
					...linearStates.filter((state) => state.name !== "Canceled"),
					{
						id: "st-approved",
						name: "Approved",
						type: "started",
						position: 2037,
						color: "#BB87FC",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				const names = report.statuses.map((lane) => lane.name);
				const review = names.indexOf("In Review");
				const approvedAt = names.indexOf("Approved");
				expect(approvedAt).toBeGreaterThan(review);
				expect(names.indexOf("Awaiting merge")).toBe(-1);
				const approved = report.statuses.find(
					(lane) => lane.name === "Approved",
				);
				expect(approved).toEqual({
					id: "st-approved",
					name: "Approved",
					colour: "#BB87FC",
					statusType: "inProgress",
					evidence: "awaitingMerge",
				});
				expect(flight(report)).toEqual([
					placed("WID-9", "Wait for the merge", "Approved", "inProgress"),
				]);
			},
		);
	});

	test("a GitHub project lane mapping uses the owner and number", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
				laneMappings: {
					"acme/4": { awaitingMerge: "Ready" },
				},
			}),
			projectFetch([
				projectItem(14, "Ready to merge", { name: "Ready", color: "PURPLE" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.statuses.map((lane) => lane.name)).not.toContain(
					"Awaiting merge",
				);
				expect(report.statuses.find((lane) => lane.name === "Ready")).toEqual({
					id: "61e4505c",
					name: "Ready",
					colour: "#4C9AFF",
					statusType: "backlog",
					evidence: "awaitingMerge",
				});
				expect(flight(report)).toEqual([
					placed("acme/widget#14", "Ready to merge", "Ready", "backlog"),
				]);
			},
		);
	});

	test("a repeated-space mapping name matches the named status", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
				laneMappings: {
					[linearTeam.key]: { awaitingMerge: "  Approved  " },
				},
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
					teams: { nodes: [linearTeam] },
				},
				issues: [
					linearIssue("WID-10", "Named with spaces", {
						id: "st-approved",
						name: "Approved",
						type: "started",
						color: "#BB87FC",
					}),
				],
				states: [
					...linearStates,
					{
						id: "st-approved",
						name: "Approved",
						type: "started",
						position: 4.5,
						color: "#BB87FC",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.statuses.map((lane) => lane.name)).not.toContain(
					"Awaiting merge",
				);
				expect(
					report.statuses.find((lane) => lane.name === "Approved")?.evidence,
				).toBe("awaitingMerge");
			},
		);
	});
});
