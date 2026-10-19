import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const linearSlug = "widget-launch";
const githubRepo = "acme/widget";
const plainRepo = "acme/plain";
const projectId = "PVT_widget";

type Lane = {
	id: string;
	name: string;
	colour: string;
	statusType: string;
	added?: boolean;
	evidence?: string;
};

type FlightItem = {
	key: string | null;
	title: string;
	state: string;
	blockers: string[];
	lane: string;
	statusType: string;
	blocked?: boolean;
};

type ProjectBody = {
	name: string;
	tracker: string;
	lanes: Lane[];
	sections: {
		id: string;
		items?: FlightItem[];
		diagrams?: { nodes: { ticket: string | null }[] }[];
	}[];
};

type OverviewBody = {
	projects: {
		name: string;
		blocked?: number;
		inProgress?: number;
		statusTypes?: Record<string, number>;
		tickets: {
			key: string | null;
			lane?: string;
			statusType?: string;
			state: string;
		}[];
	}[];
};

const linearTeam = {
	id: "team-widget",
	key: "WID",
	name: "Widget",
};

const linearStates = [
	{
		id: "st-triage",
		name: "Triage",
		type: "triage",
		position: 0,
		color: "#FC7840",
	},
	{
		id: "st-backlog",
		name: "Backlog",
		type: "backlog",
		position: 1,
		color: "#BEC2C8",
	},
	{
		id: "st-todo",
		name: "Todo",
		type: "unstarted",
		position: 2,
		color: "#E2E2E2",
	},
	{
		id: "st-progress",
		name: "In Progress",
		type: "started",
		position: 3,
		color: "#F2C94C",
	},
	{
		id: "st-review",
		name: "In Review",
		type: "started",
		position: 4,
		color: "#5E6AD2",
	},
	{
		id: "st-done",
		name: "Done",
		type: "completed",
		position: 5,
		color: "#4CB782",
	},
	{
		id: "st-canceled",
		name: "Canceled",
		type: "canceled",
		position: 6,
		color: "#95A2B3",
	},
];

const githubStatusOptions = [
	{ id: "opt-backlog", name: "Backlog", color: "GRAY" },
	{ id: "opt-ready", name: "Ready", color: "PURPLE" },
	{ id: "opt-progress", name: "In Progress", color: "YELLOW" },
	{ id: "opt-review", name: "In Review", color: "BLUE" },
	{ id: "opt-done", name: "Done", color: "GREEN" },
];

function linearIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt: "2026-08-18T12:00:00.000Z",
		state,
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
	};
}

function githubIssue(
	number: number,
	title: string,
	repo: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		labels: [],
		...fields,
	};
}

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function repoFetch(
	repos: Record<string, Record<string, unknown>[]>,
	labels: Record<string, { name: string; color: string }[]> = {},
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		for (const [repo, issues] of Object.entries(repos)) {
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page(issues);
			}
			if (url.startsWith(`https://api.github.com/repos/${repo}/labels?`)) {
				return page(labels[repo] ?? []);
			}
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.endsWith("/comments")
		) {
			return page([]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

function projectItem(
	number: number,
	title: string,
	status: { name: string; color: string } | null,
	content: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		fieldValueByName:
			status === null
				? null
				: {
						name: status.name,
						optionId: `opt-${status.name}`,
						color: status.color,
					},
		content: {
			__typename: "Issue",
			id: `I_${number}`,
			number,
			title,
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-08-18T12:00:00Z",
			body: "",
			repository: { nameWithOwner: githubRepo },
			milestone: null,
			labels: { nodes: [] },
			parent: null,
			blockedBy: { nodes: [] },
			...content,
		},
	};
}

function projectFetch(
	items: Record<string, unknown>[],
	options = githubStatusOptions,
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
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
							number: 4,
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
			return Response.json({
				data: {
					node: {
						fields: {
							nodes: [
								{},
								{
									__typename: "ProjectV2SingleSelectField",
									id: "PVTSSF_status",
									name: "Status",
									options,
								},
								{},
							],
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ProjectItems")
		) {
			return Response.json({
				data: {
					node: {
						items: {
							nodes: items,
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		if (url.includes("/pulls?") || url.includes("/labels?")) {
			return page([]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

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

async function projectOf(base: string, name: string): Promise<ProjectBody> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectBody;
}

function flight(report: ProjectBody): FlightItem[] {
	const lanes = new Map(
		report.lanes.map((lane) => [lane.name, lane.statusType]),
	);
	return report.sections
		.filter((section) => section.id === "inFlight" || section.id === "backlog")
		.flatMap((section) =>
			(section.items ?? []).flatMap((item) => {
				const lane =
					item.lane === "" && section.id === "backlog"
						? (report.lanes.find(
								(candidate) => candidate.statusType === "backlog",
							)?.name ?? "")
						: item.lane;
				const statusType = lanes.get(lane);
				if (lane === "" || statusType === undefined) {
					return [];
				}
				return [{ ...item, lane, statusType }];
			}),
		);
}

function placed(
	key: string,
	title: string,
	lane: string,
	statusType: string,
): FlightItem {
	return {
		key,
		title,
		state: statusType,
		blockers: [],
		lane,
		statusType,
	};
}

describe("tracker lanes", () => {
	test("a Linear team returns its workflow statuses as lanes", async () => {
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
					linearIssue("WID-1", "Ship the list", {
						id: "st-progress",
						name: "In Progress",
						type: "started",
						color: "#F2C94C",
					}),
					linearIssue("WID-2", "Write the notes", {
						id: "st-todo",
						name: "Todo",
						type: "unstarted",
						color: "#E2E2E2",
					}),
				],
				states: linearStates,
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Triage",
					"Backlog",
					"Todo",
					"In Progress",
					"In Review",
					"Awaiting merge",
					"Done",
					"Canceled",
				]);
				expect(report.lanes.find((lane) => lane.name === "In Review")).toEqual({
					id: "st-review",
					name: "In Review",
					colour: "#5E6AD2",
					statusType: "inReview",
				});
				expect(
					report.lanes.find((lane) => lane.name === "Done")?.statusType,
				).toBe("done");
				expect(
					report.lanes.find((lane) => lane.name === "Canceled")?.statusType,
				).toBe("dropped");
				expect(
					report.lanes.find((lane) => lane.name === "Triage")?.colour,
				).toBe("#FC7840");
				expect(flight(report)).toEqual([
					placed("WID-1", "Ship the list", "In Progress", "inProgress"),
					placed("WID-2", "Write the notes", "Todo", "backlog"),
				]);
			},
		);
	});

	test("a GitHub project returns its Status options as lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(7, "Draw the nodes", {
					name: "In Progress",
					color: "YELLOW",
				}),
				projectItem(8, "Write the copy", { name: "Backlog", color: "GRAY" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(
					report.lanes.map((lane) => [lane.name, lane.colour, lane.statusType]),
				).toEqual([
					["Backlog", "#BEC2C8", "backlog"],
					["Ready", "#5E6AD2", "backlog"],
					["In Progress", "#F2C94C", "inProgress"],
					["In Review", "#4C9AFF", "inReview"],
					["Awaiting merge", "#B7E1CD", "awaitingMerge"],
					["Done", "#4CB782", "done"],
				]);
				expect(flight(report)).toEqual([
					placed(
						"acme/widget#7",
						"Draw the nodes",
						"In Progress",
						"inProgress",
					),
					placed("acme/widget#8", "Write the copy", "Backlog", "backlog"),
				]);
			},
		);
	});

	test("a repo with factory labels uses those labels as lanes", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			repoFetch(
				{
					[githubRepo]: [
						githubIssue(1, "Queue the job", githubRepo, {
							labels: [{ name: "ready" }],
						}),
						githubIssue(2, "Run the job", githubRepo, {
							labels: [{ name: "factory: running" }],
						}),
						githubIssue(3, "Review the job", githubRepo, {
							labels: [{ name: "factory: in-review" }],
						}),
					],
				},
				{
					[githubRepo]: [
						{ name: "ready", color: "5319e7" },
						{ name: "factory: running", color: "fbca04" },
						{ name: "factory: in-review", color: "1d76db" },
						{ name: "bug", color: "d73a4a" },
					],
				},
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(
					report.lanes.map((lane) => [lane.name, lane.colour, lane.statusType]),
				).toEqual([
					["ready", "#5319E7", "backlog"],
					["factory: running", "#FBCA04", "inProgress"],
					["factory: in-review", "#1D76DB", "inReview"],
					["Awaiting merge", "#B7E1CD", "awaitingMerge"],
				]);
				expect(
					flight(report)
						.map((item) => [item.key, item.lane, item.statusType])
						.toSorted((left, right) =>
							(left[0] ?? "").localeCompare(right[0] ?? ""),
						),
				).toEqual([
					["acme/widget#1", "ready", "backlog"],
					["acme/widget#2", "factory: running", "inProgress"],
					["acme/widget#3", "factory: in-review", "inReview"],
				]);
			},
		);
	});

	test("a repo without factory labels uses the app lanes", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: plainRepo }] }),
			repoFetch({
				[plainRepo]: [githubIssue(1, "Write the notes", plainRepo)],
			}),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, plainRepo);
				expect(
					report.lanes.map((lane) => [lane.name, lane.colour, lane.statusType]),
				).toEqual([
					["Backlog", "#D0D7DE", "backlog"],
					["In progress", "#F0C674", "inProgress"],
					["In review", "#9ECBFF", "inReview"],
					["Awaiting merge", "#B7E1CD", "awaitingMerge"],
					["Done", "#8FBC8F", "done"],
					["Dropped", "#9CA3AF", "dropped"],
				]);
				expect(flight(report)).toEqual([
					placed("acme/plain#1", "Write the notes", "Backlog", "backlog"),
				]);
			},
		);
	});

	test("a GitHub project ticket with an empty Status uses the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([projectItem(9, "No status yet", null)], []),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Backlog",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				]);
				const ticket = report.sections
					.flatMap((section) => section.items ?? [])
					.find((item) => item.key === "acme/widget#9");
				expect(ticket?.state).toBe("backlog");
				expect(report.lanes[0]?.name).toBe("Backlog");
			},
		);
	});

	test("a blocked ticket in a tracker lane stays in that lane", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				{
					...projectItem(21, "Wait on the gate", {
						name: "In Progress",
						color: "YELLOW",
					}),
					content: {
						...(projectItem(21, "Wait on the gate", {
							name: "In Progress",
							color: "YELLOW",
						}).content as Record<string, unknown>),
						body: "Blocked by: acme/widget#8",
					},
				},
				projectItem(8, "The gate", { name: "Backlog", color: "GRAY" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				const items = report.sections.flatMap((section) => section.items ?? []);
				const waiting = items.find((item) => item.key === "acme/widget#21");
				expect(waiting?.lane).toBe("In Progress");
				expect(waiting?.statusType).toBe("inProgress");
				expect(waiting?.state).toBe("inProgress");
				expect(waiting?.blocked).toBe(true);
				const flightKeys = report.sections
					.find((section) => section.id === "inFlight")
					?.items?.map((item) => item.key);
				expect(flightKeys).toEqual(["acme/widget#21"]);
				const chains = report.sections.find(
					(section) => section.id === "blockingChains",
				);
				expect(
					chains?.diagrams?.[0]?.nodes.some(
						(node) => node.ticket === "acme/widget#21",
					),
				).toBe(true);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const card = overview.projects.find(
					(item) => item.name === "Widget board",
				);
				expect(card?.blocked).toBe(1);
				expect(card?.inProgress).toBe(0);
				expect(card?.statusTypes?.inProgress).toBe(1);
			},
		);
	});

	test("an empty Status places only that ticket by the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(7, "Draw the nodes", {
					name: "In Progress",
					color: "YELLOW",
				}),
				projectItem(9, "No status yet", null),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Backlog",
					"Ready",
					"In Progress",
					"In Review",
					"Awaiting merge",
					"Done",
				]);
				expect(report.lanes.map((lane) => lane.statusType)).toEqual([
					"backlog",
					"backlog",
					"inProgress",
					"inReview",
					"awaitingMerge",
					"done",
				]);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const placedItem = items.find((item) => item.key === "acme/widget#7");
				const empty = items.find((item) => item.key === "acme/widget#9");
				expect(placedItem?.lane).toBe("In Progress");
				expect(placedItem?.statusType).toBe("inProgress");
				expect(empty?.lane).toBe("Backlog");
				expect(empty?.statusType).toBe("backlog");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				expect(
					overview.projects.find((item) => item.name === "Widget board")
						?.statusTypes,
				).toEqual({
					backlog: 1,
					inProgress: 1,
					inReview: 0,
					awaitingMerge: 0,
					done: 0,
					dropped: 0,
				});
			},
		);
	});

	test("an empty Status uses a renamed board lane of that status type", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
			{ id: "opt-shipped", name: "Shipped", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(9, "No status yet", null),
					projectItem(8, "Blank status", { name: "   ", color: "GRAY" }),
					projectItem(10, "Shipped without a status", null, {
						state: "CLOSED",
						stateReason: "COMPLETED",
					}),
					projectItem(15, "Closed with no reason", null, {
						state: "CLOSED",
						stateReason: null,
					}),
					projectItem(12, "Dropped without a status", null, {
						state: "CLOSED",
						stateReason: "NOT_PLANNED",
					}),
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Todo",
					"Doing",
					"Review",
					"Awaiting merge",
					"Shipped",
					"Dropped",
				]);
				expect(report.lanes.map((lane) => lane.name)).not.toContain("Backlog");
				expect(report.lanes.map((lane) => lane.name)).not.toContain("Done");
				const sections = report.sections.flatMap(
					(section) => section.items ?? [],
				);
				const open = sections.find((item) => item.key === "acme/widget#9");
				const blank = sections.find((item) => item.key === "acme/widget#8");
				expect(open?.lane).toBe("Todo");
				expect(open?.statusType).toBe("backlog");
				expect(blank?.lane).toBe("Todo");
				expect(blank?.statusType).toBe("backlog");
				expect(
					report.lanes.find((lane) => lane.name === "Dropped")?.added,
				).toBe(true);
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const tickets =
					overview.projects.find((item) => item.name === "Widget board")
						?.tickets ?? [];
				const names = new Set(report.lanes.map((lane) => lane.name));
				expect(tickets.find((item) => item.key === "acme/widget#10")).toEqual(
					expect.objectContaining({ lane: "Shipped", statusType: "done" }),
				);
				expect(tickets.find((item) => item.key === "acme/widget#15")).toEqual(
					expect.objectContaining({ lane: "Shipped", statusType: "done" }),
				);
				expect(tickets.find((item) => item.key === "acme/widget#12")).toEqual(
					expect.objectContaining({ lane: "Dropped", statusType: "dropped" }),
				);
				for (const item of tickets) {
					expect(item.lane === undefined || names.has(item.lane)).toBe(true);
				}
			},
		);
	});

	test("an empty Status adds the app lane when the board has no lane of that type", async () => {
		const options = [
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(9, "No status yet", null),
					projectItem(11, "Wait for review", { name: "Review", color: "BLUE" }),
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Backlog",
					"Doing",
					"Review",
					"Awaiting merge",
				]);
				expect(report.lanes.find((lane) => lane.name === "Doing")).toEqual({
					id: "opt-doing",
					name: "Doing",
					colour: "#F2C94C",
					statusType: "inProgress",
				});
				const added = report.lanes.find((lane) => lane.name === "Backlog");
				expect(added?.statusType).toBe("backlog");
				expect(added?.colour).toBe("#D0D7DE");
				expect(added?.added).toBe(true);
				const items = report.sections.flatMap((section) => section.items ?? []);
				const empty = items.find((item) => item.key === "acme/widget#9");
				const placedItem = items.find((item) => item.key === "acme/widget#11");
				expect(empty?.lane).toBe("Backlog");
				expect(empty?.statusType).toBe("backlog");
				expect(placedItem?.lane).toBe("Review");
				const names = new Set(report.lanes.map((lane) => lane.name));
				for (const item of items) {
					expect(item.lane === undefined || names.has(item.lane)).toBe(true);
				}
			},
		);
	});

	test("a board without a matching status gets Awaiting merge after In Review", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-doing", name: "Doing", color: "YELLOW" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
			{ id: "opt-shipped", name: "Shipped", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[projectItem(11, "Wait for review", { name: "Review", color: "BLUE" })],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Todo",
					"Doing",
					"Review",
					"Awaiting merge",
					"Shipped",
				]);
				const added = report.lanes.find(
					(lane) => lane.name === "Awaiting merge",
				);
				expect(added?.statusType).toBe("awaitingMerge");
				expect(added?.colour).toBe("#B7E1CD");
				expect(added?.added).toBe(true);
			},
		);
	});

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
						position: 4.5,
						color: "#BB87FC",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				const names = report.lanes.map((lane) => lane.name);
				const review = names.indexOf("In Review");
				const approvedAt = names.indexOf("Approved");
				expect(approvedAt).toBeGreaterThan(review);
				expect(names.indexOf("Awaiting merge")).toBe(-1);
				const approved = report.lanes.find((lane) => lane.name === "Approved");
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
				expect(report.lanes.map((lane) => lane.name)).not.toContain(
					"Awaiting merge",
				);
				expect(report.lanes.find((lane) => lane.name === "Ready")).toEqual({
					id: "opt-ready",
					name: "Ready",
					colour: "#5E6AD2",
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
				expect(report.lanes.map((lane) => lane.name)).not.toContain(
					"Awaiting merge",
				);
				expect(
					report.lanes.find((lane) => lane.name === "Approved")?.evidence,
				).toBe("awaitingMerge");
			},
		);
	});

	test("a blank Status and a failing status read use the app lanes", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			async (input, init) => {
				const url = urlOf(input);
				const body = typeof init?.body === "string" ? init.body : "";
				if (
					url === "https://api.github.com/graphql" &&
					body.includes("ProjectFields")
				) {
					return new Response("not recorded", { status: 404 });
				}
				return projectFetch([
					projectItem(12, "Blank status", { name: "  ", color: "" }),
				])(input, init);
			},
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(report.lanes.map((lane) => lane.name)).toEqual([
					"Backlog",
					"In progress",
					"In review",
					"Awaiting merge",
					"Done",
					"Dropped",
				]);
				expect(
					report.sections
						.flatMap((section) => section.items ?? [])
						.find((item) => item.key === "acme/widget#12")?.state,
				).toBe("backlog");
			},
		);
	});

	test("a repeated-space status name matches its option", async () => {
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch([
				projectItem(13, "Spaced status", {
					name: "In  Review",
					color: "BLUE",
				}),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(flight(report)[0]?.lane).toBe("In Review");
				expect(flight(report)[0]?.statusType).toBe("inReview");
			},
		);
	});

	test("a closed factory ticket sits in Done", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			repoFetch(
				{
					[githubRepo]: [
						githubIssue(4, "Ship the job", githubRepo, {
							state: "closed",
							state_reason: "completed",
							labels: [{ name: "ready" }],
						}),
					],
				},
				{
					[githubRepo]: [
						{ name: "ready", color: "5319e7" },
						{ name: "factory: running", color: "fbca04" },
						{ name: "factory: in-review", color: "1d76db" },
					],
				},
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const project = overview.projects.find(
					(item) => item.name === githubRepo,
				);
				const ticket = project?.tickets.find(
					(item) => item.key === "acme/widget#4",
				);
				expect(ticket?.lane).toBe("Done");
				expect(ticket?.statusType).toBe("done");
				expect(project?.statusTypes?.done).toBe(1);
				expect(project?.statusTypes?.backlog).toBe(0);
			},
		);
	});

	test("a closed ticket with no matching status sits in Done", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			repoFetch(
				{
					[githubRepo]: [
						githubIssue(5, "Closed without a done label", githubRepo, {
							state: "closed",
							state_reason: "completed",
						}),
					],
				},
				{
					[githubRepo]: [
						{ name: "ready", color: "5319e7" },
						{ name: "factory: running", color: "fbca04" },
						{ name: "factory: in-review", color: "1d76db" },
					],
				},
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const ticket = overview.projects
					.find((item) => item.name === githubRepo)
					?.tickets.find((item) => item.key === "acme/widget#5");
				expect(ticket?.lane).toBe("Done");
				expect(ticket?.statusType).toBe("done");
			},
		);
	});

	test("repeated spaces in an awaiting lane name skip the added lane", async () => {
		const options = [
			{ id: "opt-todo", name: "Todo", color: "GRAY" },
			{ id: "opt-review", name: "Review", color: "BLUE" },
			{ id: "opt-awaiting", name: "Awaiting  merge", color: "GREEN" },
		];
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", owner: "acme", project: 4 }],
			}),
			projectFetch(
				[
					projectItem(15, "Wait for merge", {
						name: "Awaiting  merge",
						color: "GREEN",
					}),
				],
				options,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, "Widget board");
				expect(
					report.lanes.filter((lane) => lane.statusType === "awaitingMerge"),
				).toEqual([
					{
						id: "opt-awaiting",
						name: "Awaiting  merge",
						colour: "#4CB782",
						statusType: "awaitingMerge",
					},
				]);
				expect(flight(report)[0]?.lane).toBe("Awaiting  merge");
			},
		);
	});

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

	test("a closed Linear ticket in Released sits in Done", async () => {
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
					linearIssue("WID-20", "Released the list", {
						id: "st-released",
						name: "Released",
						type: "completed",
						color: "#4CB782",
					}),
				],
				states: [
					...linearStates,
					{
						id: "st-released",
						name: "Released",
						type: "completed",
						position: 5.5,
						color: "#4CB782",
					},
				],
			}),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(report.lanes.map((lane) => lane.name)).toContain("Released");
				const overview = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as OverviewBody;
				const ticket = overview.projects
					.find((item) => item.name === "Widget launch")
					?.tickets.find((item) => item.key === "WID-20");
				expect(ticket?.lane).toBe("Released");
				expect(ticket?.statusType).toBe("done");
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
						id: "st-todo",
						name: "Todo",
						type: "unstarted",
						color: "#E2E2E2",
					}),
					linearIssue("WID-2", "Second", {
						id: "st-backlog",
						name: "Backlog",
						type: "backlog",
						color: "#BEC2C8",
					}),
					linearIssue("WID-3", "Third", {
						id: "st-progress",
						name: "In Progress",
						type: "started",
						color: "#F2C94C",
					}),
					linearIssue("WID-4", "Fourth", {
						id: "st-review",
						name: "In Review",
						type: "started",
						color: "#5E6AD2",
					}),
					linearIssue("WID-5", "Fifth", {
						id: "st-done",
						name: "Done",
						type: "completed",
						color: "#4CB782",
					}),
					linearIssue("WID-6", "Sixth", {
						id: "st-canceled",
						name: "Canceled",
						type: "canceled",
						color: "#95A2B3",
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
