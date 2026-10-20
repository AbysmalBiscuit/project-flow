import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectReport } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
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

function linearIssue(
	identifier: string,
	description: string,
	stateType: string,
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title: identifier,
		description,
		updatedAt: "2026-08-18T12:00:00.000Z",
		state: { type: stateType },
		inverseRelations: { nodes: [] },
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

function githubFetch(
	issues = githubIssues,
	others = otherIssues,
	calls?: string[],
): Fetch {
	return async (input, init) => {
		calls?.push(urlOf(input));
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
			return page(others);
		}
		if (url.includes("/labels?")) {
			return page([]);
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
		return emptyProjectFields(input, init) ?? unrecorded(input);
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
	now?: () => Date,
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
				...(now === undefined ? {} : { now }),
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
					"needsYou",
					"backlog",
				]);
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
					'acme_2f_widget_23_2["feat(ux): draw the nodes"]:::backlog',
				);
				expect(epicMap?.definition).not.toContain("classDef blocked");
				expect(epicMap?.definition).toContain(
					"classDef inProgress fill:#f0c674",
				);
				expect(epicMap?.definition).toContain("classDef dropped fill:#9ca3af");
				expect(epicMap?.definition).toContain("classDef backlog fill:#d0d7de");
				expect(epicMap?.definition).toContain(
					'Ship_20_the_20_map_3a_Ship_20_the_20_map["Ship the map"]:::theme',
				);
				expect(epicMap?.definition).toContain(
					"github_3a_acme_2f_platform_3a_acme_2f_platform_23_9",
				);
				const dashed = epicMap?.nodes.find((node) => node.dashed);
				expect(dashed?.project).toBe("acme/platform");
				expect(dashed?.ticket).toBe("acme/platform#9");
				const platform = (await (
					await fetch(new URL("/api/projects/acme%2Fplatform", base))
				).json()) as ProjectReport;
				expect(
					platform.sections
						.find((section) => section.id === "featureMap")
						?.diagrams?.some((diagram) =>
							diagram.nodes.some((node) => node.ticket === "acme/platform#9"),
						),
				).toBe(true);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_October",
				);
				expect(october?.definition).not.toContain("acme_2f_widget_23_2");
				const flight = first.sections.find(
					(section) => section.id === "inFlight",
				);
				expect(flight?.items?.map((item) => item.key)).toEqual([
					"acme/widget#4",
					"acme/widget#40",
				]);
				expect(
					first.sections
						.find((section) => section.id === "blockingChains")
						?.diagrams?.[0]?.nodes.some(
							(node) => node.ticket === "acme/widget#2",
						),
				).toBe(true);
				const backlog = first.sections.find(
					(section) => section.id === "backlog",
				);
				expect(backlog?.items?.map((item) => item.key)).toEqual([
					"acme/widget#1",
					"acme/widget#2",
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
					"Needs you",
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_October",
				);
				expect(
					october?.nodes.find((node) => node.ticket === "acme/widget#11")
						?.label,
				).toBe("Draw the legend");
				expect(
					october?.nodes
						.filter((node) => node.state === "theme")
						.map((node) => node.label),
				).toEqual(["Ship the board"]);
				expect(october?.definition).toContain(
					'October_3a_Ship_20_the_20_board["Ship the board"]:::theme',
				);
				expect(october?.definition).toContain(
					"October_3a_Ship_20_the_20_board --> acme_2f_widget_23_11",
				);
				expect(october?.definition).not.toContain(
					'["Draw the legend"]:::theme',
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
				body.includes("ProjectFields")
			) {
				return emptyProjectFields(input, init) ?? unrecorded(input);
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
			return emptyProjectFields(input, init) ?? unrecorded(input);
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
				const map = report.sections.find(
					(section) => section.id === "featureMap",
				);
				const board = map?.diagrams?.find(
					(diagram) => diagram.id === "map_3a_Ship_20_the_20_board",
				);
				expect(board?.definition).toContain(
					'Ship_20_the_20_board_3a_Draw_20_the_20_legend["Draw the legend"]:::theme',
				);
				expect(board?.definition).toContain(
					"Ship_20_the_20_board_3a_Draw_20_the_20_legend --> acme_2f_widget_23_42",
				);
				const leafEdge = board?.edges.find(
					(edge) => edge.to === "acme_2f_widget_23_42",
				);
				expect(
					board?.nodes.find((node) => node.id === leafEdge?.from)?.label,
				).toBe("Draw the legend");
			},
		);
	});

	test("each ticket lists its blockers, outside blockers and the tickets it blocks in other projects", async () => {
		const gate = issue(8, "Open the gate", { body: "Blocks: #2" }, githubRepo);
		const drawn = issue(2, "feat(ux): draw the nodes", {
			body: `Blocked by: #8\nBlocked by: ${otherRepo}#9`,
		});
		const held = issue(
			11,
			"Hold the platform",
			{ body: `Blocked by: ${githubRepo}#2` },
			otherRepo,
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch(
				[issue(1, "Ship the map"), drawn, gate],
				[issue(9, "Platform gate", {}, otherRepo), held],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const drawnView = report.tickets.find(
					(item) => item.key === `${githubRepo}#2`,
				);
				expect(drawnView?.blockers).toEqual([
					`${githubRepo}#8`,
					`${otherRepo}#9`,
				]);
				expect(drawnView?.outsideBlockers).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#9`,
						title: "Platform gate",
					},
				]);
				expect(drawnView?.blocks).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
				]);
				const local = report.tickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(local?.outsideBlockers ?? []).toEqual([]);
				expect(local?.blocks ?? []).toEqual([]);
				const empty = report.tickets.find(
					(item) => item.key === `${githubRepo}#1`,
				);
				expect(empty?.blockers).toEqual([]);
				expect(empty?.outsideBlockers ?? []).toEqual([]);
				expect(empty?.blocks ?? []).toEqual([]);
				const spacedBody = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					spacedBody.tickets.find((item) => item.key === `${otherRepo}#11`)
						?.blockers,
				).toEqual([`${githubRepo}#2`]);
				const blank = await fetch(
					new URL(`/api/projects/${encodeURIComponent("   ")}`, base),
				);
				expect(blank.status).toBe(404);
			},
		);
	});

	test("A Blocks B yields A.blocks and B.blockers across projects", async () => {
		const otherSlug = "platform-gate";
		const gate = {
			...issue(8, "Open the gate", {}, githubRepo),
			issue_dependencies_summary: {
				blocked_by: 0,
				blocking: 1,
				total_blocked_by: 0,
				total_blocking: 1,
			},
		};
		const held = issue(11, "Hold the platform", {}, otherRepo);
		const closed = {
			...issue(
				12,
				"Closed gate",
				{ state: "closed", state_reason: "completed" },
				githubRepo,
			),
			issue_dependencies_summary: {
				blocked_by: 0,
				blocking: 1,
				total_blocked_by: 0,
				total_blocking: 1,
			},
		};
		const named = issue(
			13,
			"Named blocked by",
			{ body: `Blocked by: ${githubRepo}#8` },
			otherRepo,
		);
		const closedHeld = issue(
			14,
			"Already shipped",
			{ state: "closed", state_reason: "completed" },
			otherRepo,
		);
		const linearGate = {
			...linearIssue("WID-8", "", "started"),
			title: "Open the gate",
			inverseRelations: {
				nodes: [
					{
						type: "blockedBy",
						issue: {
							identifier: "PLAT-11",
							title: "Hold the platform",
							state: { type: "started" },
							project: { name: "Platform gate", slugId: otherSlug },
						},
					},
					{
						type: "blockedBy",
						issue: {
							identifier: "PLAT-14",
							title: "Already shipped",
							state: { type: "completed" },
							project: { name: "Platform gate", slugId: otherSlug },
						},
					},
				],
			},
		};
		const linearClosed = {
			...linearIssue("WID-12", "Blocks: PLAT-11", "completed"),
			title: "Closed gate",
		};
		const linearHeld = {
			...linearIssue("PLAT-11", "", "started"),
			title: "Hold the platform",
		};
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
					{ tracker: "linear", project: linearSlug },
					{ tracker: "linear", project: otherSlug },
				],
			}),
			async (input, init) => {
				const url = urlOf(input);
				if (url === "https://api.linear.app/graphql") {
					const body = typeof init?.body === "string" ? init.body : "";
					const query = JSON.parse(body) as {
						query?: string;
						variables?: { pin?: string };
					};
					if (query.query?.includes("MemberProjects")) {
						return Response.json({
							data: {
								viewer: { id: "viewer-ada" },
								projects: {
									nodes: [
										{
											id: "project-widget",
											name: linearSlug,
											slugId: linearSlug,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
										{
											id: "project-platform",
											name: otherSlug,
											slugId: otherSlug,
											updatedAt: "2026-08-18T12:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						});
					}
					if (query.query?.includes("viewer")) {
						return Response.json({ data: { viewer: { id: "viewer-ada" } } });
					}
					if (query.query?.includes("ProjectByPin")) {
						const pin = query.variables?.pin;
						const project =
							pin === linearSlug
								? {
										id: "project-widget",
										name: linearSlug,
										slugId: linearSlug,
									}
								: pin === otherSlug
									? {
											id: "project-platform",
											name: otherSlug,
											slugId: otherSlug,
										}
									: null;
						return Response.json({
							data: { projects: { nodes: project === null ? [] : [project] } },
						});
					}
					if (query.query?.includes("ProjectIssues")) {
						const nodes = body.includes("project-platform")
							? [linearHeld]
							: [linearGate, linearClosed];
						return Response.json({
							data: {
								issues: {
									nodes,
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						});
					}
					return Response.json({ data: {} });
				}
				const blocking = `https://api.github.com/repos/${githubRepo}/issues/8/dependencies/blocking?per_page=100&page=1`;
				const closedBlocking = `https://api.github.com/repos/${githubRepo}/issues/12/dependencies/blocking?per_page=100&page=1`;
				if (url === blocking) {
					return page([
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
						{
							number: 14,
							state: "closed",
							title: "Already shipped",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
					]);
				}
				if (url === closedBlocking) {
					return page([
						{
							number: 11,
							state: "open",
							title: "Hold the platform",
							repository_url: `https://api.github.com/repos/${otherRepo}`,
						},
					]);
				}
				return githubFetch(
					[issue(1, "Ship the map"), gate, closed],
					[held, named, closedHeld],
				)(input, init);
			},
			{
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
			},
			async (base) => {
				const source = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				const gateView = source.tickets.find(
					(item) => item.key === `${githubRepo}#8`,
				);
				expect(gateView?.blockers).toEqual([]);
				expect(gateView?.blocks).toEqual([
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#11`,
						title: "Hold the platform",
					},
					{
						tracker: "github",
						project: otherRepo,
						key: `${otherRepo}#13`,
						title: "Named blocked by",
					},
				]);
				expect(
					source.tickets.find((item) => item.key === `${githubRepo}#12`)
						?.blocks ?? [],
				).toEqual([]);
				const other = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherRepo)}`, base),
					)
				).json()) as ProjectReport;
				const heldView = other.tickets.find(
					(item) => item.key === `${otherRepo}#11`,
				);
				expect(heldView?.blockers).toEqual([`${githubRepo}#8`]);
				expect(heldView?.outsideBlockers).toEqual([
					{
						tracker: "github",
						project: githubRepo,
						key: `${githubRepo}#8`,
						title: "Open the gate",
					},
				]);
				expect(heldView?.blocks ?? []).toEqual([]);
				expect(
					other.tickets.find((item) => item.key === `${otherRepo}#13`)
						?.blockers,
				).toEqual([`${githubRepo}#8`]);
				const repeated = await fetch(
					new URL(`/api/projects/${encodeURIComponent("  ")}`, base),
				);
				expect(repeated.status).toBe(404);
				const linear = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(linearSlug)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					linear.tickets.find((item) => item.key === "WID-8")?.blocks,
				).toEqual([
					{
						tracker: "linear",
						project: otherSlug,
						key: "PLAT-11",
						title: "Hold the platform",
					},
				]);
				expect(
					linear.tickets.find((item) => item.key === "WID-12")?.blocks ?? [],
				).toEqual([]);
				const platform = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(otherSlug)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					platform.tickets.find((item) => item.key === "PLAT-11")?.blockers,
				).toEqual(["WID-8"]);
				expect(
					platform.tickets.find((item) => item.key === "PLAT-11")
						?.outsideBlockers,
				).toEqual([
					{
						tracker: "linear",
						project: linearSlug,
						key: "WID-8",
						title: "Open the gate",
					},
				]);
			},
		);
	});

	test("a filter change writes the project view settings and survives a restart", async () => {
		const config = JSON.stringify({
			pinned: [{ tracker: "github", repo: githubRepo }],
		});
		const issues = [
			issue(1, "Ship the map", {
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
			issue(2, "Draw the legend", {
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Old done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-01T12:00:00.000Z",
			}),
			issue(4, "Recent done work", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "cy" },
				assignees: [{ login: "cy" }],
				updated_at: "2026-08-17T12:00:00.000Z",
			}),
			issue(5, "Dropped the draft", {
				state: "closed",
				state_reason: "not_planned",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
		];
		const keys = async (base: string) => {
			const report = (await (
				await fetch(
					new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
				)
			).json()) as ProjectReport;
			return {
				lanes: report.lanes.map((lane) => lane.name),
				tickets: report.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [ticket.key],
				),
			};
		};
		let path = "";
		let cleanup = async () => {};
		const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
		try {
			const temp = await tempConfig(config);
			path = temp.path;
			cleanup = temp.cleanup;
			const start = (check: (base: string) => Promise<void>): Promise<void> => {
				let startChecks: (base: string) => void = () => {};
				const checks = new Promise<void>((resolve, reject) => {
					startChecks = (line) => {
						check(line).then(resolve).catch(reject);
					};
				});
				return run(
					["--config", path, "--host", "127.0.0.1", "--port", "0"],
					testIo({
						env: { GITHUB_TOKEN: "recorded-token" },
						fetch: githubFetch(issues, []),
						readGhToken: async () => null,
						databasePath: join(root, "store.sqlite"),
						now: () => new Date("2026-08-18T12:00:00.000Z"),
						stdout: (line) => startChecks(line),
						waitForStop: checks,
					}),
				).then((result) => {
					expect(result.stderr).toBe("");
					expect(result.exitCode).toBe(0);
				});
			};
			await start(async (base) => {
				const open = await keys(base);
				expect(open.lanes).toContain("Done");
				expect(open.lanes).toContain("Dropped");
				expect(open.tickets).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
					`${githubRepo}#4`,
				]);
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, Record<string, unknown>>;
				};
				expect(current.projectViews).toEqual({});
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								shownLanes: ["Backlog", "Done"],
								maxAgeDays: { Done: 2, Backlog: 0 },
								needsYouOnly: false,
								blockedOnly: false,
								assignees: ["ada", "cy"],
								search: "done",
								openView: "table",
								graphDirection: "top-to-bottom",
							},
						},
					}),
				});
				expect(saved.status).toBe(200);
				const written = (await saved.json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(written.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					openView: "table",
					graphDirection: "top-to-bottom",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
			await start(async (base) => {
				const again = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, unknown>;
				};
				expect(again.projectViews[githubRepo]).toEqual({
					shownLanes: ["Backlog", "Done"],
					maxAgeDays: { Done: 2, Backlog: 0 },
					needsYouOnly: false,
					blockedOnly: false,
					assignees: ["ada", "cy"],
					search: "done",
					openView: "table",
					graphDirection: "top-to-bottom",
				});
				const filtered = await keys(base);
				expect(filtered.tickets).toEqual([`${githubRepo}#4`]);
			});
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the board hides a lane, drops tickets older than the lane max age, and filters by several assignees and by search", async () => {
		const calls: string[] = [];
		const issues = [
			issue(1, "Ship the map", {
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }, { login: "bea" }],
			}),
			issue(2, "Draw the legend", {
				assignee: { login: "bea" },
				assignees: [{ login: "bea" }],
			}),
			issue(3, "Hold the copy", {
				assignee: { login: "cy" },
				assignees: [{ login: "cy" }],
			}),
			issue(4, "Recent done map", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-17T12:00:00.000Z",
			}),
			issue(6, "Old done map", {
				state: "closed",
				state_reason: "completed",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
				updated_at: "2026-08-10T12:00:00.000Z",
			}),
			issue(7, "Dropped map", {
				state: "closed",
				state_reason: "not_planned",
				assignee: { login: "ada" },
				assignees: [{ login: "ada" }],
			}),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: {
						shownLanes: ["Backlog", "Done"],
						maxAgeDays: { Done: 3 },
						assignees: ["Ada", "Bea"],
						search: " map",
					},
				},
			}),
			githubFetch(issues, [], calls),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(report.lanes.map((lane) => lane.name)).toContain("Backlog");
				expect(report.lanes.map((lane) => lane.name)).toContain("Dropped");
				expect(
					report.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([`${githubRepo}#1`, `${githubRepo}#4`]);
				const settings = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<
						string,
						{
							assignees: string[];
							search: string;
							maxAgeDays: Record<string, number>;
						}
					>;
				};
				const saved = settings.projectViews[githubRepo];
				expect(saved?.assignees).toEqual(["Ada", "Bea"]);
				expect(saved?.search).toBe(" map");
				expect(saved?.maxAgeDays).toEqual({ Done: 3 });
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const blankSearch = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: {
								shownLanes: ["Backlog"],
								assignees: ["", "  "],
								search: "   ",
								maxAgeDays: { Done: 0 },
							},
						},
					}),
				});
				expect(blankSearch.status).toBe(200);
				const cleared = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(cleared.lanes.map((lane) => lane.name)).toContain("Dropped");
				expect(
					cleared.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([`${githubRepo}#1`, `${githubRepo}#2`, `${githubRepo}#3`]);
				const rejected = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							[githubRepo]: { openView: "kanban", maxAgeDays: { Done: -1 } },
						},
					}),
				});
				expect(rejected.status).toBe(400);
				const named = (await rejected.json()) as { error: string };
				expect(named.error).toContain("projectViews");
				const left = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { search: string }>;
				};
				expect(left.projectViews[githubRepo]?.search).toBe("   ");
				const hidden = (await (
					await fetch(
						new URL(
							`/api/projects/${encodeURIComponent(githubRepo)}?view=all`,
							base,
						),
					)
				).json()) as ProjectReport;
				expect(
					hidden.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([
					`${githubRepo}#1`,
					`${githubRepo}#2`,
					`${githubRepo}#3`,
					`${githubRepo}#4`,
					`${githubRepo}#6`,
					`${githubRepo}#7`,
				]);
				const before = calls.length;
				const events = await fetch(new URL("/api/events", base), {
					headers: { accept: "text/event-stream" },
				});
				const reader = events.body?.getReader();
				expect(reader).toBeDefined();
				const opened = await reader?.read();
				expect(new TextDecoder().decode(opened?.value)).toContain(": open");
				const viewOnly = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...left,
						projectViews: {
							[githubRepo]: { search: "legend" },
						},
					}),
				});
				expect(viewOnly.status).toBe(200);
				expect(calls.length).toBe(before);
				const published = await reader?.read();
				expect(new TextDecoder().decode(published?.value)).toContain(
					"event: overview",
				);
				await reader?.cancel();
				const repeated = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...left,
						projectViews: {
							[githubRepo]: { search: "map  map", assignees: ["  ada  "] },
						},
					}),
				});
				expect(repeated.status).toBe(200);
				const spaced = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					spaced.tickets.flatMap((ticket) =>
						ticket.key === null ? [] : [ticket.key],
					),
				).toEqual([]);
				const failed = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: "not json",
				});
				expect(failed.status).toBe(400);
				const kept = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as {
					projectViews: Record<string, { search: string }>;
				};
				expect(kept.projectViews[githubRepo]?.search).toBe("map  map");
			},
			() => new Date("2026-08-18T12:00:00.000Z"),
		);
	});

	test("a saved filter keeps each ticket's update time", async () => {
		const calls: string[] = [];
		const issues = [
			issue(1, "Ship the map", { updated_at: "2026-08-18T09:00:00.000Z" }),
			issue(2, "Draw the legend", {
				updated_at: "2026-08-12T09:00:00.000Z",
				assignee: { login: "bea" },
			}),
			issue(3, "Hold the map copy", { updated_at: "2026-08-18T15:00:00.000Z" }),
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				projectViews: {
					[githubRepo]: {
						search: "map",
						needsYouOnly: false,
						blockedOnly: false,
					},
				},
			}),
			githubFetch(issues, [], calls),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(
					report.tickets.map((ticket) => ({
						key: ticket.key,
						updatedAt: ticket.updatedAt,
					})),
				).toEqual([
					{
						key: `${githubRepo}#1`,
						updatedAt: "2026-08-18T09:00:00.000Z",
					},
					{
						key: `${githubRepo}#3`,
						updatedAt: "2026-08-18T15:00:00.000Z",
					},
				]);
				const blank = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						pinned: [{ tracker: "github", repo: githubRepo }],
						projectViews: {
							[githubRepo]: { search: "   " },
						},
					}),
				});
				expect(blank.status).toBe(200);
				const cleared = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport;
				expect(cleared.tickets.map((ticket) => ticket.updatedAt)).toEqual([
					"2026-08-18T09:00:00.000Z",
					"2026-08-12T09:00:00.000Z",
					"2026-08-18T15:00:00.000Z",
				]);
			},
		);
	});

	test("a project with no own view uses the star view, and its own entry wins", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const current = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
						},
					}),
				});
				expect(saved.status).toBe(200);
				const report = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport & { openView: string };
				expect(report.openView).toBe("graph");
				const blank = await fetch(new URL("/api/projects/%20", base));
				expect(blank.status).toBe(404);
				const own = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph" },
							[githubRepo]: { openView: "table" },
						},
					}),
				});
				expect(own.status).toBe(200);
				const won = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport & { openView: string };
				expect(won.openView).toBe("table");
				const spaced = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...current,
						projectViews: {
							"*": { openView: "graph", search: "   " },
						},
					}),
				});
				expect(spaced.status).toBe(200);
				const kept = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as ProjectReport & { openView: string };
				expect(kept.openView).toBe("graph");
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
