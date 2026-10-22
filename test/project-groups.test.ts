import { describe, expect, test } from "bun:test";
import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import {
	githubFetch,
	githubRepo,
	issue,
	linearIssue,
	linearIssues,
	linearSlug,
	otherRepo,
	withApp,
} from "./project-harness.ts";
import {
	emptyProjectFields,
	linearFake,
	recordedDiscovery,
	type TrackerRequest,
	trackerRequest,
	unrecorded,
	urlOf,
} from "./support.ts";

const linearProject = {
	id: "project-widget",
	name: "Widget launch",
	slugId: linearSlug,
};

const platformEpic = {
	identifier: "PLT-3",
	title: "Platform epic",
	url: "https://linear.app/acme/issue/PLT-3/platform-epic",
	state: { type: "started" },
	project: { name: "Platform" },
};

const underPlatform = {
	id: "under-platform",
	identifier: "WID-5",
	title: "Wire the platform hook",
	description: "",
	state: { type: "unstarted" },
	updatedAt: "2026-08-18T12:00:00.000Z",
	parent: platformEpic,
	projectMilestone: null,
	labels: { nodes: [] },
};

const underPlatformGate = issue(25, "Wait on the other repo", {
	parent: {
		number: 9,
		title: "Platform gate",
		state: "CLOSED",
		url: `https://github.com/${otherRepo}/issues/9`,
		repository: { nameWithOwner: otherRepo },
	},
});

const projectId = "PVT_widget";
const widgetBoard: Fetch = async (input, init) => {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ProjectByNumber")
	) {
		return Response.json({
			data: {
				repositoryOwner: {
					projectV2: {
						id: projectId,
						number: 3,
						title: "Widget board",
						closed: false,
						updatedAt: "2026-08-18T12:00:00Z",
					},
				},
			},
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ProjectFields")
	) {
		return emptyProjectFields(input, init) ?? unrecorded(input);
	}
	if (url === "https://api.github.com/graphql" && body.includes("node(id:")) {
		return Response.json({
			data: {
				node: {
					items: {
						nodes: [
							{
								content: {
									__typename: "Issue",
									number: 11,
									title: "Ship the board",
									state: "OPEN",
									stateReason: null,
									updatedAt: "2026-08-18T12:00:00Z",
									repository: { nameWithOwner: githubRepo },
									milestone: { title: "October" },
									labels: { nodes: [{ name: "epic" }] },
									parent: null,
								},
							},
							{
								content: {
									__typename: "Issue",
									number: 12,
									title: "Draw the legend",
									state: "OPEN",
									stateReason: null,
									updatedAt: "2026-08-18T12:00:00Z",
									repository: { nameWithOwner: githubRepo },
									milestone: { title: "October" },
									labels: { nodes: [] },
									parent: {
										number: 11,
										repository: { nameWithOwner: githubRepo },
									},
								},
							},
							{
								content: {
									__typename: "DraftIssue",
									title: "Not a ticket",
								},
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	return emptyProjectFields(input, init) ?? unrecorded(input);
};
function recording(sent: TrackerRequest[], inner: Fetch): Fetch {
	return (input, init) => {
		sent.push(trackerRequest(input, init));
		return inner(input, init);
	};
}

async function reportOf(base: string, name: string): Promise<ProjectReport> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	return (await response.json()) as ProjectReport;
}

describe("GET /api/projects/:name", () => {
	test("the same tracker data gives the same project report", async () => {
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const first = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const second = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(second).toEqual(first);
				expect(first.sections.map((section) => section.id)).toEqual([
					"summary",
					"inFlight",
					"needsYou",
					"backlog",
				]);
				const summary = first.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toBe(
					"acme/widget: 0 done, 0 dropped, 1 blocked, 1 in progress, 3 backlog.",
				);
				const flight = first.sections.find(
					(section) => section.id === "inFlight",
				);
				expect(flight?.items?.map((item) => item.key)).toEqual([
					"acme/widget#4",
					"acme/widget#40",
				]);
				const blocked = first.tickets.find(
					(ticket) => ticket.key === "acme/widget#2",
				);
				expect(blocked?.blocked).toBe(true);
				const backlog = first.sections.find(
					(section) => section.id === "backlog",
				);
				expect(backlog?.items?.map((item) => item.key)).toEqual([
					"acme/widget#1",
					"acme/widget#2",
					"acme/widget#3",
				]);
				const groupOf = (key: string) => {
					const ticket = first.tickets.find((item) => item.key === key);
					return {
						workstream: ticket?.workstream,
						theme: ticket?.theme,
					};
				};
				expect(groupOf("acme/widget#1")).toEqual({
					workstream: "Ship the map",
					theme: "Ship the map",
				});
				expect(groupOf("acme/widget#2")).toEqual({
					workstream: "Ship the map",
					theme: "ux",
				});
				expect(groupOf("acme/widget#3")).toEqual({
					workstream: "October",
					theme: "no scope",
				});
				expect(groupOf("acme/widget#4")).toEqual({
					workstream: "no workstream",
					theme: "no scope",
				});
			},
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: linearSlug },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
				},
				issues: linearIssues,
				github: githubFetch(),
			}),
			{ GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const linearReport = (await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as ProjectReport;
				const again = (await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as ProjectReport;
				expect(again).toEqual(linearReport);
				expect(linearReport.sections.map((section) => section.title)).toEqual([
					"Summary",
					"In flight",
					"Needs you",
					"Backlog",
				]);
				const linearSummary = linearReport.sections.find(
					(section) => section.id === "summary",
				);
				expect(linearSummary?.text).toContain("1 blocked");
				expect(linearSummary?.text).toContain("4 backlog");
				const held = linearReport.tickets.find(
					(ticket) => ticket.key === "WID-2",
				);
				expect(held?.blocked).toBe(true);
				const groupOf = (key: string) => {
					const ticket = linearReport.tickets.find((item) => item.key === key);
					return {
						workstream: ticket?.workstream,
						theme: ticket?.theme,
					};
				};
				expect(groupOf("WID-1")).toEqual({
					workstream: "Beta",
					theme: "Launch epic",
				});
				expect(groupOf("WID-4")).toEqual({
					workstream: "Beta",
					theme: "no scope",
				});
				expect(groupOf("WID-2")).toEqual({
					workstream: "Later",
					theme: "Ship the list",
				});
				expect(groupOf("WID-3")).toEqual({
					workstream: "Beta",
					theme: "no scope",
				});
			},
		);
	});

	test("a Linear ticket with no milestone takes the first ancestor milestone", async () => {
		const issues = [
			{
				id: "parent",
				identifier: "WID-1",
				title: "Launch epic",
				description: "",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				projectMilestone: { name: "Beta" },
				labels: { nodes: [{ name: "epic" }] },
				parent: null,
			},
			{
				id: "story",
				identifier: "WID-4",
				title: "Ship the list",
				description: "",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				parent: { identifier: "WID-1" },
				projectMilestone: null,
				labels: { nodes: [] },
			},
			{
				id: "child",
				identifier: "WID-8",
				title: "List the rows",
				description: "",
				state: { type: "unstarted" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				parent: { identifier: "WID-4" },
				projectMilestone: null,
				labels: { nodes: [] },
			},
		];
		await withApp(
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
				const report = (await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === "WID-8"),
				).toMatchObject({ workstream: "Beta" });
			},
		);
	});

	test("a GitHub ticket with no milestone takes its parent issue as its workstream", async () => {
		const parent = issue(21, "Ship the list");
		const child = issue(22, "Draw the rows", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/21`,
		});
		const grandchild = issue(23, "Name the columns", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/22`,
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([parent, child, grandchild]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const workstreamOf = (number: number) =>
					report.tickets.find(
						(ticket) => ticket.key === `${githubRepo}#${number}`,
					)?.workstream;
				expect(workstreamOf(21)).toBe("no workstream");
				expect(workstreamOf(22)).toBe("Ship the list");
				expect(workstreamOf(23)).toBe("Draw the rows");
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#22`)
						?.workstreamKey,
				).toBe(`${githubRepo}#21`);
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#23`)
						?.workstreamKey,
				).toBe(`${githubRepo}#22`);
			},
		);
	});

	test("two GitHub parents with the same title keep separate workstream keys", async () => {
		const first = issue(41, "Ship the list");
		const second = issue(42, "Ship the list");
		const underFirst = issue(43, "Draw the rows", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/41`,
		});
		const underSecond = issue(44, "Name the columns", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/42`,
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([first, second, underFirst, underSecond]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const of = (number: number) =>
					report.tickets.find(
						(ticket) => ticket.key === `${githubRepo}#${number}`,
					);
				expect(of(43)?.workstream).toBe("Ship the list");
				expect(of(44)?.workstream).toBe("Ship the list");
				expect(of(43)?.workstreamKey).toBe(`${githubRepo}#41`);
				expect(of(44)?.workstreamKey).toBe(`${githubRepo}#42`);
			},
		);
	});

	test("a GitHub ticket with a blank parent stays in no workstream", async () => {
		const lone = issue(24, "Leave the draft", {
			parent_issue_url: "   ",
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([lone]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#24`),
				).toMatchObject({ workstream: "no workstream" });
			},
		);
	});

	test("a GitHub ticket whose parent is outside the project stays in no workstream", async () => {
		const orphan = issue(25, "Wait on the other repo", {
			parent_issue_url: `https://api.github.com/repos/${otherRepo}/issues/9`,
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([orphan]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#25`),
				).toMatchObject({ workstream: "no workstream" });
			},
		);
	});

	test("a GitHub ticket under a non-epic root takes its own milestone", async () => {
		const parent = issue(7, "Write the notes");
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
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#8`),
				).toMatchObject({ workstream: "October" });
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#7`),
				).toMatchObject({ workstream: "no workstream" });
			},
		);
	});

	test("an Epic label makes the ticket the GitHub workstream", async () => {
		const parent = issue(31, "Ship the board", {
			labels: [{ name: "Epic" }],
		});
		const child = issue(32, "Draw the legend", {
			parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/31`,
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
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#31`),
				).toMatchObject({ workstream: "Ship the board" });
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#32`),
				).toMatchObject({ workstream: "Ship the board" });
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

	test("a Projects v2 pin groups by milestone, epic label and parent", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 3 }],
			}),
			widgetBoard,
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(new URL("/api/projects/Widget%20board", base))
				).json()) as ProjectReport;
				expect(report.name).toBe("Widget board");
				expect(report.tracker).toBe("github");
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#11`),
				).toMatchObject({
					workstream: "Ship the board",
					theme: "Ship the board",
				});
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#12`),
				).toMatchObject({
					workstream: "Ship the board",
					theme: "no scope",
				});
				const backlog = report.sections.find(
					(section) => section.id === "backlog",
				);
				expect(backlog?.items?.map((item) => item.key)).toEqual([
					"acme/widget#11",
					"acme/widget#12",
				]);
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

	test("a three-level Linear chain gives each ticket its parent key", async () => {
		const issues = [
			{
				...linearIssue("WID-1", "", "started"),
				title: "Launch epic",
				parent: null,
			},
			{
				...linearIssue("WID-4", "", "unstarted"),
				title: "Ship the list",
				parent: { identifier: "WID-1" },
			},
			{
				...linearIssue("WID-6", "", "unstarted"),
				title: "Name the list",
				parent: { identifier: "WID-1" },
			},
			{
				...linearIssue("WID-8", "", "unstarted"),
				title: "List the rows",
				parent: { identifier: "WID-4" },
			},
		];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({ project: linearProject, issues }),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await reportOf(base, "Widget launch");
				const hierarchy = Object.fromEntries(
					report.tickets.map((ticket) => [
						ticket.key,
						{ parent: ticket.parent, subTickets: ticket.subTickets },
					]),
				);
				expect(hierarchy).toEqual({
					"WID-1": { parent: undefined, subTickets: 2 },
					"WID-4": { parent: "WID-1", subTickets: 1 },
					"WID-6": { parent: "WID-1", subTickets: undefined },
					"WID-8": { parent: "WID-4", subTickets: undefined },
				});
				expect(report.outsideParents).toEqual([]);
			},
		);
	});

	test("a parent ticket in another project gives an outside parent entry", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({ project: linearProject, issues: [underPlatform] }),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await reportOf(base, "Widget launch");
				expect(
					report.tickets.find((ticket) => ticket.key === "WID-5")?.parent,
				).toBe("PLT-3");
				expect(report.outsideParents).toEqual([
					{
						tracker: "linear",
						project: "Platform",
						key: "PLT-3",
						title: "Platform epic",
						state: "open",
						url: "https://linear.app/acme/issue/PLT-3/platform-epic",
					},
				]);
			},
		);
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([underPlatformGate], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await reportOf(base, githubRepo);
				expect(
					report.tickets.find((ticket) => ticket.key === `${githubRepo}#25`)
						?.parent,
				).toBe(`${otherRepo}#9`);
				expect(report.outsideParents).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#9`,
						title: "Platform gate",
						state: "closed",
						url: `https://github.com/${otherRepo}/issues/9`,
					},
				]);
			},
		);
	});

	test("the tracker reads ask for the parent fields and send no request per parent", async () => {
		const linearSent: TrackerRequest[] = [];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({
				project: linearProject,
				issues: [underPlatform],
				sent: linearSent,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				await reportOf(base, "Widget launch");
			},
		);
		const issueReads = linearSent.filter((sent) =>
			sent.query.includes("query ProjectIssues"),
		);
		expect(issueReads.length).toBeGreaterThan(0);
		for (const read of issueReads) {
			expect(read.query).toContain(
				"parent { identifier title url state { type } project { name } }",
			);
		}
		expect(
			linearSent.filter((sent) => JSON.stringify(sent).includes("PLT-3")),
		).toEqual([]);
		const githubSent: TrackerRequest[] = [];
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recording(githubSent, githubFetch([underPlatformGate], [])),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				await reportOf(base, githubRepo);
			},
		);
		const repoReads = githubSent.filter((sent) =>
			sent.query.includes("query RepoRead"),
		);
		expect(repoReads.length).toBeGreaterThan(0);
		expect(
			repoReads.some((read) =>
				read.query.includes(
					"parent { number title state url repository { nameWithOwner } }",
				),
			),
		).toBe(true);
		expect(
			githubSent.filter((sent) => JSON.stringify(sent).includes("platform")),
		).toEqual([]);
		const boardSent: TrackerRequest[] = [];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 3 }],
			}),
			recording(boardSent, widgetBoard),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				await reportOf(base, "Widget board");
			},
		);
		const itemReads = boardSent.filter((sent) =>
			sent.query.includes("query ProjectItems"),
		);
		expect(itemReads.length).toBeGreaterThan(0);
		for (const read of itemReads) {
			expect(read.query).toContain(
				"parent { number title state url repository { nameWithOwner } }",
			);
		}
	});
});
