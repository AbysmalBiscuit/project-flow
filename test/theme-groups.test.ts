import { describe, expect, test } from "bun:test";

import type { ProjectReport } from "../src/domain.ts";
import { githubFetch, githubRepo, issue, withApp } from "./project-harness.ts";

describe("GET /api/projects/:name", () => {
	test("a theme group names a workstream that matches its theme once", async () => {
		const parent = issue(20, "feat: redesign the board");
		const same = issue(21, "feat(board): draw the lanes", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/20`,
		});
		const otherParent = issue(30, "feat: redesign the inbox");
		const other = issue(31, "feat(inbox): draw the rows", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/30`,
			milestone: { title: "October" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([parent, same, otherParent, other]),
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
				expect(groupOf(31)).toMatchObject({
					workstream: "October",
					theme: "feat: redesign the inbox",
					themeGroup: "October / feat: redesign the inbox",
				});
				expect(groupOf(20)).toMatchObject({
					themeGroup: "feat: redesign the board",
				});
			},
		);
	});

	test("a breaking conventional title is grouped by its scope", async () => {
		const breaking = issue(6, "feat(ux)!: redraw the nodes");
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([breaking]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#6`),
				).toMatchObject({ theme: "ux" });
			},
		);
	});

	test("a mid-level parent takes the top parent's title as its theme", async () => {
		const top = issue(10, "Ship the board", {
			milestone: { title: "October" },
		});
		const mid = issue(11, "Draw the legend", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/10`,
			milestone: { title: "October" },
		});
		const leaf = issue(12, "feat(legend): add the key", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/11`,
			milestone: { title: "October" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([top, mid, leaf]),
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
				expect(groupOf(11)).toMatchObject({
					workstream: "October",
					theme: "Ship the board",
				});
				expect(groupOf(12)).toMatchObject({
					workstream: "October",
					theme: "Ship the board",
				});
				expect(groupOf(10)).toMatchObject({ theme: "Ship the board" });
			},
		);
	});

	test("a ticket that is the root of another ticket takes its own title as its theme", async () => {
		const parent = issue(7, "Write the notes", {
			milestone: { title: "October" },
		});
		const child = issue(8, "feat(notes): add the heading", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/7`,
			milestone: { title: "October" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([parent, child]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#7`),
				).toMatchObject({ theme: "Write the notes" });
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#8`),
				).toMatchObject({ theme: "Write the notes" });
			},
		);
	});

	test("a root epic workstream themes the nearest parent below it", async () => {
		const root = issue(40, "Ship the board", {
			labels: [{ name: "Epic" }],
		});
		const mid = issue(41, "Draw the legend", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/40`,
		});
		const leaf = issue(42, "feat(legend): add the key", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/41`,
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([root, mid, leaf]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#42`),
				).toMatchObject({
					workstream: "Ship the board",
					theme: "Draw the legend",
				});
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#41`),
				).toMatchObject({
					workstream: "Ship the board",
					theme: "no scope",
				});
			},
		);
	});
});
