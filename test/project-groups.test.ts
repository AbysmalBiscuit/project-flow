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
						state: "inProgress",
						url: "https://linear.app/acme/issue/PLT-3/platform-epic",
						tracked: false,
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
						state: "done",
						url: `https://github.com/${otherRepo}/issues/9`,
						tracked: false,
					},
				]);
			},
		);
	});

	test("an outside parent ticket in a tracked project is marked tracked", async () => {
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch([underPlatformGate], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await reportOf(base, githubRepo);
				expect(report.outsideParents).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#9`,
						title: "Platform gate",
						state: "done",
						url: `https://github.com/${otherRepo}/issues/9`,
						tracked: true,
					},
				]);
			},
		);
	});

	test("an outside parent ticket carries the lane state of its workflow state", async () => {
		const under = (
			identifier: string,
			parent: string,
			state: { type: string; name: string },
		) => ({
			...underPlatform,
			id: identifier,
			identifier,
			parent: {
				...platformEpic,
				identifier: parent,
				url: `https://linear.app/acme/issue/${parent}`,
				state,
			},
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			linearFake({
				project: linearProject,
				issues: [
					under("WID-11", "PLT-11", { type: "started", name: "In Review" }),
					under("WID-12", "PLT-12", { type: "completed", name: "Done" }),
					under("WID-13", "PLT-13", { type: "canceled", name: "Canceled" }),
					under("WID-14", "PLT-14", {
						type: "duplicate",
						name: "Duplicate",
					}),
					under("WID-15", "PLT-15", { type: "unstarted", name: "Todo" }),
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await reportOf(base, "Widget launch");
				expect(
					report.outsideParents.map((parent) => [parent.key, parent.state]),
				).toEqual([
					["PLT-11", "inReview"],
					["PLT-12", "done"],
					["PLT-13", "dropped"],
					["PLT-14", "dropped"],
					["PLT-15", "backlog"],
				]);
			},
		);
		const gateUnder = (
			number: number,
			parent: number,
			state: string,
			stateReason: string | null,
		) =>
			issue(number, `Wait on gate ${parent}`, {
				parent: {
					number: parent,
					title: `Gate ${parent}`,
					state,
					stateReason,
					url: `https://github.com/${otherRepo}/issues/${parent}`,
					repository: { nameWithOwner: otherRepo },
				},
			});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(
				[
					gateUnder(31, 41, "CLOSED", "COMPLETED"),
					gateUnder(32, 42, "CLOSED", "NOT_PLANNED"),
					gateUnder(33, 43, "CLOSED", "DUPLICATE"),
					gateUnder(34, 44, "OPEN", null),
				],
				[],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await reportOf(base, githubRepo);
				expect(
					report.outsideParents.map((parent) => [parent.key, parent.state]),
				).toEqual([
					[`${otherRepo}#41`, "done"],
					[`${otherRepo}#42`, "dropped"],
					[`${otherRepo}#43`, "dropped"],
					[`${otherRepo}#44`, undefined],
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
				"parent { identifier title url state { type name } project { name } }",
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
					"parent { number title state stateReason url repository { nameWithOwner } }",
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
				"parent { number title state stateReason url repository { nameWithOwner } }",
			);
		}
	});
});
