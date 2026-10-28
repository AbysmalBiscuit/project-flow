import { describe, expect, test } from "bun:test";

import { linearFake } from "../support/linear.ts";
import {
	githubIssue,
	linearIssue,
	linearSlug,
	linearStates,
	linearTeam,
	type OverviewBody,
	plainRepo,
	projectFetch,
	projectItem,
	repoFetch,
	withApp,
} from "./_support.ts";

describe("tracker lanes", () => {
	test("a GitHub project on the app lanes counts by status type", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(16, "Open with no board", null),
					{
						...projectItem(17, "Closed with no board", null),
						content: {
							...(projectItem(17, "Closed with no board", null)
								.content as Record<string, unknown>),
							state: "CLOSED",
							stateReason: "COMPLETED",
						},
					},
				],
				[],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					overview.projects.find((item) => item.name === "Widget board")
						?.statusTypes,
				).toEqual({
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					done: 1,
					dropped: 0,
				});
			},
		);
	});

	test("the overview counts a repo on the app lanes by status type", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: plainRepo }] }),
			repoFetch({
				[plainRepo]: [
					githubIssue(1, "Open note", plainRepo),
					githubIssue(2, "Shipped note", plainRepo, {
						state: "closed",
						state_reason: "completed",
					}),
				],
			}),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					overview.projects.find((item) => item.name === plainRepo)
						?.statusTypes,
				).toEqual({
					backlog: 1,
					inProgress: 0,
					inReview: 0,
					awaitingMerge: 0,
					done: 1,
					dropped: 0,
				});
			},
		);
	});

	test("the overview counts tickets by status type", async () => {
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
					linearIssue("WID-1", "First", {
						id: "364b3510-9325-4af6-9df1-8f2ff56f7a3d",
						name: "Todo",
						type: "unstarted",
						color: "#e2e2e2",
					}),
					linearIssue("WID-2", "Second", {
						id: "48b815cc-6b89-42b0-85c6-bcd9078325d2",
						name: "Backlog",
						type: "backlog",
						color: "#bec2c8",
					}),
					linearIssue("WID-3", "Third", {
						id: "cce36b04-d482-4233-b1d8-33eda76ca025",
						name: "In Progress",
						type: "started",
						color: "#f2c94c",
					}),
					linearIssue("WID-4", "Fourth", {
						id: "558ba933-745c-42e2-8969-b3757c54bd5c",
						name: "In Review",
						type: "started",
						color: "#4cb782",
					}),
					linearIssue("WID-5", "Fifth", {
						id: "710a74b9-7f91-4b5d-ad74-cc0b4f47de6b",
						name: "Done",
						type: "completed",
						color: "#5e6ad2",
					}),
					linearIssue("WID-6", "Sixth", {
						id: "b7a25ac4-725d-4b68-a34b-534a428c5162",
						name: "Canceled",
						type: "canceled",
						color: "#95a2b3",
					}),
				],
				states: linearStates,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const project = overview.projects.find(
					(item) => item.name === "Widget launch",
				);
				expect(project?.statusTypes).toEqual({
					backlog: 2,
					inProgress: 1,
					inReview: 1,
					awaitingMerge: 0,
					done: 1,
					dropped: 1,
				});
			},
		);
	});
});
