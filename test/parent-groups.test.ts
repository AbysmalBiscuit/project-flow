import { describe, expect, test } from "bun:test";
import type { ProjectReport } from "../src/domain.ts";
import {
	githubFetch,
	githubRepo,
	issue,
	linearSlug,
	withApp,
} from "./project-harness.ts";
import { linearFake } from "./support.ts";

const linearTicket = (
	id: string,
	title: string,
	parent: string | null,
	milestone: string | null,
) => ({
	id,
	identifier: id,
	title,
	description: "",
	state: { type: "unstarted" },
	updatedAt: "2026-08-18T12:00:00.000Z",
	projectMilestone: milestone === null ? null : { name: milestone },
	labels: { nodes: [] },
	parent: parent === null ? null : { identifier: parent },
});

const linearReport = async (
	issues: ReturnType<typeof linearTicket>[],
	check: (report: ProjectReport) => void,
) =>
	withApp(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: linearSlug }],
		}),
		linearFake({
			project: {
				id: "project-widget",
				name: "Widget launch",
				slugId: linearSlug,
			},
			issues,
		}),
		{ LINEAR_API_KEY: "recorded-linear-key" },
		async (base) => {
			check(
				(await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as ProjectReport,
			);
		},
	);

const githubReport = async (
	issues: ReturnType<typeof issue>[],
	check: (report: ProjectReport) => void,
) =>
	withApp(
		JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
		githubFetch(issues),
		{ GITHUB_TOKEN: "recorded-token" },
		async (base) => {
			check(
				(await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport,
			);
		},
	);

const subTicketOf = (parent: number) => ({
	parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/${parent}`,
});

describe("GET /api/projects/:name", () => {
	test("a Linear parent with no milestone shares the group of its sub-tickets", async () => {
		await linearReport(
			[
				linearTicket("WID-1", "Ship the list", null, null),
				linearTicket("WID-2", "Draw the rows", "WID-1", "Beta"),
				linearTicket("WID-3", "Name the columns", "WID-1", "Beta"),
				linearTicket("WID-4", "Sort the rows", "WID-1", "Later"),
			],
			(report) => {
				for (const key of ["WID-1", "WID-2", "WID-3"]) {
					expect(report.tickets.find((item) => item.key === key)).toMatchObject(
						{
							workstream: "Beta",
							theme: "Ship the list",
							themeGroup: "Beta / Ship the list",
						},
					);
				}
			},
		);
	});

	test("a nested Linear parent tree shares the milestone of its deepest sub-ticket", async () => {
		await linearReport(
			[
				linearTicket("WID-1", "Ship the list", null, null),
				linearTicket("WID-2", "Draw the rows", "WID-1", null),
				linearTicket("WID-5", "Paint the cells", "WID-2", "Beta"),
			],
			(report) => {
				for (const key of ["WID-1", "WID-2", "WID-5"]) {
					expect(report.tickets.find((item) => item.key === key)).toMatchObject(
						{
							workstream: "Beta",
							themeGroup: "Beta / Ship the list",
						},
					);
				}
			},
		);
	});

	test("a GitHub top parent with no milestone shares the group of its sub-tickets", async () => {
		await githubReport(
			[
				issue(21, "Ship the list"),
				issue(22, "Draw the rows", subTicketOf(21)),
				issue(23, "Name the columns", subTicketOf(22)),
			],
			(report) => {
				for (const number of [21, 22, 23]) {
					expect(
						report.tickets.find(
							(ticket) => ticket.key === `${githubRepo}#${number}`,
						),
					).toMatchObject({
						workstream: "Ship the list",
						workstreamKey: `${githubRepo}#21`,
						theme: "Ship the list",
						themeGroup: "Ship the list",
					});
				}
			},
		);
	});

	test("a GitHub top parent with no milestone takes the milestone of its sub-ticket", async () => {
		await githubReport(
			[
				issue(7, "Write the notes"),
				issue(8, "feat(notes): add the heading", {
					...subTicketOf(7),
					milestone: { title: "October" },
				}),
			],
			(report) => {
				for (const number of [7, 8]) {
					expect(
						report.tickets.find(
							(ticket) => ticket.key === `${githubRepo}#${number}`,
						),
					).toMatchObject({
						workstream: "October",
						themeGroup: "October / Write the notes",
					});
				}
			},
		);
	});

	test("a GitHub sub-ticket with no milestone joins the group of its top parent", async () => {
		await githubReport(
			[
				issue(7, "Write the notes"),
				issue(8, "feat(notes): add the heading", {
					...subTicketOf(7),
					milestone: { title: "October" },
				}),
				issue(9, "feat(notes): add the footer", {
					...subTicketOf(7),
					milestone: { title: "October" },
				}),
				issue(10, "feat(notes): add the index", subTicketOf(7)),
			],
			(report) => {
				for (const number of [7, 8, 9, 10]) {
					expect(
						report.tickets.find(
							(ticket) => ticket.key === `${githubRepo}#${number}`,
						),
					).toMatchObject({
						workstream: "October",
						workstreamKey: "October",
						themeGroup: "October / Write the notes",
					});
				}
			},
		);
	});
});
