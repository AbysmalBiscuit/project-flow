import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../src/domain.ts";
import { linearIssue, linearSlug, withApp } from "./project-harness.ts";
import type { TrackerRequest } from "./support/fetch.ts";
import { linearFake } from "./support/linear.ts";

describe("GET /api/projects/:name Linear assignees", () => {
	test("a Linear ticket names each assignee and the filter still matches the user id", async () => {
		const person = (id: string, displayName: string, email: string) => ({
			id,
			name: `${displayName} full name`,
			displayName,
			email,
		});
		const issues = [
			{
				...linearIssue("WID-1", "", "unstarted"),
				assignee: person("user-lev", "lev", "lev@example.com"),
			},
			{
				...linearIssue("WID-2", "", "unstarted"),
				assignee: person("user-ada", "ada", "ada@one.example"),
			},
			{
				...linearIssue("WID-3", "", "unstarted"),
				assignee: person("user-ada-2", "ada", "ada@two.example"),
			},
			{ ...linearIssue("WID-4", "", "unstarted"), assignee: null },
		];
		const sent: TrackerRequest[] = [];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "linear", project: linearSlug }],
				projectViews: { "Widget launch": { assignees: ["user-lev"] } },
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
				},
				issues,
				sent,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const read = async (query: string) =>
					(await (
						await fetch(new URL(`/api/projects/Widget%20launch${query}`, base))
					).json()) as ProjectReport;
				const people = (report: ProjectReport) =>
					report.tickets.map((ticket) => ({
						key: ticket.key,
						assignees: ticket.assignees,
						assigneeNames: ticket.assigneeNames,
					}));
				expect(people(await read(""))).toEqual([
					{
						key: "WID-1",
						assignees: ["user-lev"],
						assigneeNames: { "user-lev": "lev" },
					},
				]);
				expect(people(await read("?view=all"))).toEqual([
					{
						key: "WID-1",
						assignees: ["user-lev"],
						assigneeNames: { "user-lev": "lev" },
					},
					{
						key: "WID-2",
						assignees: ["user-ada"],
						assigneeNames: { "user-ada": "ada (ada@one.example)" },
					},
					{
						key: "WID-3",
						assignees: ["user-ada-2"],
						assigneeNames: { "user-ada-2": "ada (ada@two.example)" },
					},
					{ key: "WID-4", assignees: undefined, assigneeNames: undefined },
				]);
				expect(
					sent.some((request) =>
						/assignee \{[^}]*\bemail\b/.test(request.query),
					),
				).toBe(true);
			},
		);
	});
});
