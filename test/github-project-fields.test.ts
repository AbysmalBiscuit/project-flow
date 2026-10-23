import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import projectFields from "./fixtures/github-project-fields.json";
import {
	recordedViewer,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = "acme/widget";
const board = "Widget board";
const projectId = "PVT_widget";

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

const connection = (nodes: Record<string, unknown>[]) => ({
	nodes,
	pageInfo: { hasNextPage: false, endCursor: null },
});

const openIssue = {
	number: 7,
	title: "Draw the nodes",
	state: "OPEN",
	stateReason: null,
	createdAt: "2026-08-01T09:00:00Z",
	updatedAt: "2026-08-18T12:00:00Z",
	closedAt: null,
	body: "",
	labels: emptyPage,
	assignees: connection([{ login: "ada" }]),
	milestone: null,
	parent: null,
	blockedBy: emptyPage,
	blocking: connection([
		{
			number: 3,
			title: "Ship the API",
			state: "OPEN",
			repository: { nameWithOwner: "acme/api" },
		},
	]),
};

const closedIssue = {
	number: 8,
	title: "Write the copy",
	state: "CLOSED",
	stateReason: "COMPLETED",
	createdAt: "2026-07-20T09:00:00Z",
	updatedAt: "2026-08-12T08:00:00Z",
	closedAt: "2026-08-10T15:00:00Z",
	body: "",
	labels: emptyPage,
	assignees: connection([{ login: "lin" }]),
	milestone: null,
	parent: null,
	blockedBy: emptyPage,
	blocking: emptyPage,
};

const issues = [openIssue, closedIssue];

function projectItem(issue: Record<string, unknown>) {
	return {
		fieldValueByName: null,
		content: {
			__typename: "Issue",
			id: `I_${String(issue.number)}`,
			...issue,
			comments: { totalCount: 0 },
			repository: { nameWithOwner: repo },
			closedByPullRequestsReferences: emptyPage,
		},
	};
}

const trackerFetch =
	(projectIssues: Record<string, unknown>[], sent: string[] = []): Fetch =>
	async (input, init) => {
		const viewer = recordedViewer(input, init);
		if (viewer !== null) {
			return viewer;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/graphql") {
			if (body.includes("query RepoRead")) {
				return Response.json(
					repoReadIssues(
						"acme",
						"widget",
						issues.map((issue) => ({ ...issue, comments: emptyPage })),
					),
				);
			}
			if (body.includes("ProjectByNumber")) {
				return Response.json({
					data: {
						repositoryOwner: {
							projectV2: {
								id: projectId,
								number: 4,
								title: board,
								closed: false,
								updatedAt: "2026-08-18T12:00:00Z",
							},
						},
					},
				});
			}
			if (body.includes("ProjectFields")) {
				return Response.json(projectFields);
			}
			if (body.includes("ProjectItems")) {
				return Response.json({
					data: { node: { items: connection(projectIssues.map(projectItem)) } },
				});
			}
			if (body.includes("query Blocking")) {
				sent.push(body);
				return Response.json({
					data: {
						node: {
							blocking: connection([
								{
									number: 4,
									title: "Ship the docs",
									state: "OPEN",
									repository: { nameWithOwner: "acme/docs" },
								},
							]),
						},
					},
				});
			}
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return Response.json([]);
		}
		return unrecorded(input, init);
	};

type Item = {
	key: string | null;
	lane: string;
	statusType: string;
	enteredStateAt: string;
	assignees?: string[];
	blocks?: { key: string }[];
};

type ProjectBody = { tickets: Item[] };

const projectPin = { tracker: "github", owner: "acme", project: 4 };
const repoPin = { tracker: "github", repo };

async function ticketsOf(
	pin: typeof projectPin | typeof repoPin,
	name: string,
	fetchImpl = trackerFetch(issues),
): Promise<Item[]> {
	const { path, cleanup } = await tempConfig(JSON.stringify({ pinned: [pin] }));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let tickets: Item[] = [];
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			readTickets(base, name)
				.then((read) => {
					tickets = read;
					resolve();
				})
				.catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
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
	return tickets;
}

async function readTickets(base: string, name: string): Promise<Item[]> {
	await settledOverview(
		base,
		async (url) =>
			(await (await fetch(new URL("/api/overview", url))).json()) as {
				polling?: true;
			},
	);
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}?view=all`, base),
	);
	expect(response.status).toBe(200);
	const report = (await response.json()) as ProjectBody;
	return report.tickets.sort((left, right) =>
		String(left.key).localeCompare(String(right.key)),
	);
}

describe("GitHub project ticket fields", () => {
	test("a project ticket carries assignees, blocks, a created time and a closed time", async () => {
		const tickets = await ticketsOf(projectPin, board);
		expect(
			tickets.map((ticket) => ({
				key: ticket.key,
				statusType: ticket.statusType,
				enteredStateAt: ticket.enteredStateAt,
				assignees: ticket.assignees,
				blocks: ticket.blocks?.map((ref) => ref.key),
			})),
		).toEqual([
			{
				key: "acme/widget#7",
				statusType: "backlog",
				enteredStateAt: "2026-08-01T09:00:00Z",
				assignees: ["ada"],
				blocks: ["acme/api#3"],
			},
			{
				key: "acme/widget#8",
				statusType: "done",
				enteredStateAt: "2026-08-10T15:00:00Z",
				assignees: ["lin"],
				blocks: undefined,
			},
		]);
	});

	test("a ticket from a project and from its repo give the same ticket view", async () => {
		const fromProject = await ticketsOf(projectPin, board);
		const fromRepo = await ticketsOf(repoPin, repo);
		expect(fromProject).toHaveLength(issues.length);
		expect(fromProject).toEqual(fromRepo);
	});

	test("a later page of blocked tickets reaches the project ticket", async () => {
		const sent: string[] = [];
		const paged = {
			...openIssue,
			blocking: {
				...openIssue.blocking,
				pageInfo: { hasNextPage: true, endCursor: "cursor-blocking" },
			},
		};
		const tickets = await ticketsOf(
			projectPin,
			board,
			trackerFetch([paged], sent),
		);
		expect(tickets[0]?.blocks?.map((ref) => ref.key)).toEqual([
			"acme/api#3",
			"acme/docs#4",
		]);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("cursor-blocking");
	});
});
