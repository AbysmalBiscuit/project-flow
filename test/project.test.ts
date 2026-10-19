import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const githubRepo = "acme/widget";
const otherRepo = "acme/platform";
const linearSlug = "widget-launch";

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
	repo = githubRepo,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const githubIssues = [
	issue(1, "Ship the map", {
		labels: [{ name: "epic" }],
		milestone: { title: "October" },
	}),
	issue(2, "feat(ux): draw the nodes", {
		parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/1`,
		milestone: { title: "October" },
		body: `Blocked by: ${otherRepo}#9`,
	}),
	issue(3, "Write the copy", {
		milestone: { title: "October" },
	}),
	issue(4, "Draft the page", {
		body: "A draft exists.",
	}),
];

const otherIssues = [
	issue(9, "Platform gate", { labels: [{ name: "epic" }] }, otherRepo),
];

function githubFetch(issues = githubIssues): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return page(issues);
		}
		if (url.startsWith(`https://api.github.com/repos/${otherRepo}/issues?`)) {
			return page(otherIssues);
		}
		if (url.includes("/pulls?")) {
			if (url.includes(githubRepo)) {
				return page([
					{
						number: 40,
						title: "Fix the legend",
						state: "open",
						draft: true,
						html_url: `https://github.com/${githubRepo}/pull/40`,
						head: { ref: "legend" },
						body: "",
					},
				]);
			}
			return page([]);
		}
		if (url.includes("/branches?")) {
			if (url.includes(githubRepo)) {
				return page([{ name: "4-draft-the-page" }]);
			}
			return page([]);
		}
		if (url.endsWith("/comments")) {
			return page([]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

const linearIssues = [
	{
		id: "parent",
		identifier: "WID-1",
		title: "Launch epic",
		description: "",
		state: { type: "started" },
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
		identifier: "WID-2",
		title: "feat(api): list projects",
		description: `Blocked by: ${otherRepo}#9`,
		state: { type: "unstarted" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: { identifier: "WID-4" },
		projectMilestone: { name: "Later" },
		labels: { nodes: [] },
	},
	{
		id: "backlog",
		identifier: "WID-3",
		title: "Write the notes",
		description: "",
		state: { type: "backlog" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: null,
		projectMilestone: { name: "Beta" },
		labels: { nodes: [] },
	},
];

async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
): Promise<void> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("GET /api/projects/:name", () => {
	test("the same tracker data gives the same groups and diagram definitions", async () => {
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
					"featureMap",
					"inFlight",
					"blockingChains",
					"backlog",
				]);
				expect(first).not.toHaveProperty("summary");
				expect(first).not.toHaveProperty("diagrams");
				expect(first).not.toHaveProperty("highlight");
				const summary = first.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toBe(
					"acme/widget: 0 done, 0 dropped, 1 blocked, 1 in progress, 2 backlog.",
				);
				const map = first.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_3a_no_20_workstream",
					"map_3a_October",
					"map_3a_Ship_20_the_20_map",
				]);
				const epicMap = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_Ship_20_the_20_map",
				);
				expect(epicMap?.definition).toContain(
					'acme_2f_widget_23_2["feat(ux): draw the nodes"]:::blocked',
				);
				expect(epicMap?.definition).toContain("classDef blocked fill:#e6a0a0");
				expect(epicMap?.definition).toContain(
					"classDef inProgress fill:#f0c674",
				);
				expect(epicMap?.definition).toContain(
					'Ship_20_the_20_map_3a_Ship_20_the_20_map["Ship the map"]:::theme',
				);
				expect(epicMap?.definition).toContain(
					"github_3a_acme_2f_platform_3a_acme_2f_platform_23_9",
				);
				expect(epicMap?.nodes.some((node) => node.dashed)).toBe(true);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_October",
				);
				expect(october?.definition).not.toContain("acme_2f_widget_23_2");
				const flight = first.sections.find(
					(section) => section.id === "inFlight",
				);
				expect(flight?.items?.map((item) => item.key)).toEqual([
					"acme/widget#4",
					"#40",
				]);
				const backlog = first.sections.find(
					(section) => section.id === "backlog",
				);
				expect(backlog?.items?.map((item) => item.key)).toEqual([
					"acme/widget#1",
					"acme/widget#3",
				]);
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
				const definitions = (report: ProjectReport) =>
					report.sections.flatMap(
						(section) =>
							section.diagrams?.map((diagram) => diagram.definition) ?? [],
					);
				expect(definitions(again)).toEqual(definitions(linearReport));
				expect(linearReport.sections.map((section) => section.title)).toEqual([
					"Summary",
					"Feature map",
					"In flight",
					"Blocking chains",
					"Backlog",
				]);
				const linearSummary = linearReport.sections.find(
					(section) => section.id === "summary",
				);
				expect(linearSummary?.text).toContain("1 blocked");
				expect(linearSummary?.text).toContain("3 backlog");
				const linearMap = linearReport.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(linearMap?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_3a_Beta",
					"map_3a_Later",
				]);
				const beta = linearMap?.diagrams?.[0]?.definition ?? "";
				expect(beta).not.toContain("WID_2d_2");
				expect(beta).toContain("Launch epic");
				expect(beta).toContain('Beta_3a_Launch_20_epic["Launch epic"]:::theme');
				const later = linearMap?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_Later",
				);
				expect(later?.definition).toContain("WID_2d_2");
				expect(later?.definition).toContain(":::dashed");
				const chains = linearReport.sections.find(
					(section) => section.id === "blockingChains",
				);
				expect(chains?.diagrams?.[0]?.definition).toContain("WID_2d_2");
			},
		);
	});

	test("the same tickets in another order give the same diagram definitions", async () => {
		const reversed = [...githubIssues].reverse();
		const readMap = async (fetchImpl: Fetch): Promise<string[]> => {
			let definitions: string[] = [];
			await withApp(
				JSON.stringify({
					pinned: [
						{ tracker: "github", repo: githubRepo },
						{ tracker: "github", repo: otherRepo },
					],
				}),
				fetchImpl,
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = (await (
						await fetch(
							new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
						)
					).json()) as ProjectReport;
					definitions =
						report.sections
							.find((section) => section.id === "featureMap")
							?.diagrams?.map((diagram) => diagram.definition) ?? [];
				},
			);
			return definitions;
		};
		expect(await readMap(githubFetch(reversed))).toEqual(
			await readMap(githubFetch()),
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_3a_Beta",
				]);
				expect(map?.diagrams?.[0]?.definition).toContain("WID_2d_8");
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id).sort()).toEqual([
					"map_3a_October",
					"map_3a_no_20_workstream",
				]);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_October",
				);
				expect(october?.definition).toContain("acme_2f_widget_23_8");
				expect(october?.definition).not.toContain("acme_2f_widget_23_7");
			},
		);
	});

	test("a project with no blocked ticket has no blocking chain", async () => {
		const waiting = issue(5, "Write the notes", {
			milestone: { title: "October" },
			body: `Blocked by: ${otherRepo}#8`,
		});
		const closedGate = issue(
			8,
			"Closed gate",
			{ state: "closed", state_reason: "completed" },
			otherRepo,
		);
		const fetchImpl: Fetch = async (input, init) => {
			const url = urlOf(input);
			if (url.startsWith(`https://api.github.com/repos/${otherRepo}/issues?`)) {
				return page([closedGate]);
			}
			return githubFetch([waiting])(input, init);
		};
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			fetchImpl,
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const summary = report.sections.find(
					(section) => section.id === "summary",
				);
				expect(summary?.text).toContain("0 blocked");
				const chains = report.sections.find(
					(section) => section.id === "blockingChains",
				);
				expect(chains?.diagrams).toEqual([]);
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_3a_Ship_20_the_20_board",
				]);
				expect(map?.diagrams?.[0]?.definition).toContain(
					"acme_2f_widget_23_32",
				);
			},
		);
	});

	test("workstreams that differ only by punctuation get distinct diagram ids", async () => {
		const dashed = issue(21, "Ship the dashed quarter", {
			milestone: { title: "Q1-2026" },
		});
		const spaced = issue(22, "Ship the spaced quarter", {
			milestone: { title: "Q1 2026" },
		});
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch([dashed, spaced]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const ids =
					report.sections
						.find((section) => section.id === "featureMap")
						?.diagrams?.map((diagram) => diagram.id) ?? [];
				expect(new Set(ids).size).toBe(ids.length);
				expect(ids).toHaveLength(2);
				const definitions =
					report.sections
						.find((section) => section.id === "featureMap")
						?.diagrams?.map((diagram) => diagram.definition) ?? [];
				expect(
					definitions.some((line) => line.includes("acme_2f_widget_23_21")),
				).toBe(true);
				expect(
					definitions.some((line) => line.includes("acme_2f_widget_23_22")),
				).toBe(true);
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.[0]?.definition).toContain(
					'no_20_workstream_3a_ux["ux"]:::theme',
				);
				expect(map?.diagrams?.[0]?.definition).not.toContain(
					'["feat(ux)!: redraw the nodes"]:::theme',
				);
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_October",
				);
				expect(october?.definition).toContain(
					'October_3a_Write_20_the_20_notes["Write the notes"]:::theme',
				);
				expect(october?.definition).toContain(
					"October_3a_Write_20_the_20_notes --> acme_2f_widget_23_7",
				);
				expect(october?.definition).toContain(
					"October_3a_Write_20_the_20_notes --> acme_2f_widget_23_8",
				);
				expect(
					october?.nodes
						.filter((node) => node.state === "theme")
						.map((node) => node.id),
				).toEqual(["October_3a_Write_20_the_20_notes"]);
			},
		);
	});

	test("a Projects v2 pin groups by milestone, epic label and parent", async () => {
		const projectId = "PVT_widget";
		const board: Fetch = async (input, init) => {
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
				body.includes("node(id:")
			) {
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
			return new Response("not recorded", { status: 404 });
		};
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 3 }],
			}),
			board,
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(new URL("/api/projects/Widget%20board", base))
				).json()) as ProjectReport;
				expect(report.name).toBe("Widget board");
				expect(report.tracker).toBe("github");
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_3a_Ship_20_the_20_board",
				]);
				const definition = map?.diagrams?.[0]?.definition ?? "";
				expect(definition).toContain(
					'Ship_20_the_20_board_3a_Ship_20_the_20_board["Ship the board"]:::theme',
				);
				expect(definition).toContain(
					"Ship_20_the_20_board_3a_Ship_20_the_20_board -->",
				);
				expect(definition).toContain("acme_2f_widget_23_11");
				expect(definition).toContain("acme_2f_widget_23_12");
				expect(definition).not.toContain("map_3a_October");
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

	test("a missing project is not found, and a blank name is not found", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const missing = await fetch(new URL("/api/projects/missing", base));
				expect(missing.status).toBe(404);
				const blank = await fetch(new URL("/api/projects/%20", base));
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("acme/widget  ")}`, base),
				);
				expect(spaced.status).toBe(404);
				const percent = await fetch(
					new URL(`/api/projects/${encodeURIComponent("100%")}`, base),
				);
				expect(percent.status).toBe(404);
				const pageResponse = await fetch(
					new URL(`/projects/${encodeURIComponent(githubRepo)}`, base),
				);
				expect(pageResponse.status).toBe(200);
				const html = await pageResponse.text();
				expect(html).toContain('id="root"');
				expect(html).not.toContain("Feature map");
			},
		);
	});
});
