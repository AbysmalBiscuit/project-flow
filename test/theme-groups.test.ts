import { describe, expect, test } from "bun:test";
import type { ProjectReport } from "../src/domain.ts";
import { githubFetch, githubRepo, issue, withApp } from "./project-harness.ts";

describe("GET /api/projects/:name", () => {
	test("a theme group names a workstream that matches its theme once", async () => {
		const parent = issue(20, "feat: redesign the board");
		const same = issue(21, "feat(board): draw the lanes", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/20`,
		});
		const other = issue(22, "feat(board): draw the cards", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/20`,
			milestone: { title: "October" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([parent, same, other]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const groupOf = (number: number) =>
					report.tickets.find(
						(ticket) => ticket.key === `${githubRepo}#${number}`,
					);
				expect(groupOf(21)).toMatchObject({
					workstream: "feat: redesign the board",
					theme: "feat: redesign the board",
					themeGroup: "feat: redesign the board",
				});
				expect(groupOf(22)).toMatchObject({
					workstream: "October",
					theme: "feat: redesign the board",
					themeGroup: "October / feat: redesign the board",
				});
				expect(groupOf(20)).toMatchObject({
					themeGroup: "no workstream / feat: redesign the board",
				});
			},
		);
	});
});
