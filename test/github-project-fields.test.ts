import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import projectFields from "./fixtures/github-project-fields.json";
import recorded from "./fixtures/github-project-ticket-fields.json";
import {
	recordedViewer,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repo = recorded.repository;
const board = recorded.projectByNumber.data.repositoryOwner.projectV2.title;

const lastPage = { hasNextPage: false, endCursor: null };

const withoutStatus = <Item extends object>(item: Item) => ({
	...item,
	fieldValueByName: null,
});

const trackerFetch =
	(projectItems: unknown[], sent: string[] = []): Fetch =>
	async (input, init) => {
		const viewer = recordedViewer(input, init);
		if (viewer !== null) {
			return viewer;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/graphql") {
			if (body.includes("query RepoRead")) {
				const [owner = "", name = ""] = repo.split("/");
				return Response.json(repoReadIssues(owner, name, recorded.repoIssues));
			}
			if (body.includes("ProjectByNumber")) {
				return Response.json(recorded.projectByNumber);
			}
			if (body.includes("ProjectFields")) {
				return Response.json(projectFields);
			}
			if (body.includes("ProjectItems")) {
				return Response.json({
					data: {
						node: { items: { nodes: projectItems, pageInfo: lastPage } },
					},
				});
			}
			if (body.includes("query Blocking")) {
				sent.push(body);
				return Response.json(recorded.blockingNextPage);
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

const projectPin = {
	tracker: "github",
	owner: "AbysmalBiscuit",
	project: recorded.projectByNumber.data.repositoryOwner.projectV2.number,
};
const repoPin = { tracker: "github", repo };

async function ticketsOf(
	pin: typeof projectPin | typeof repoPin,
	name: string,
	fetchImpl = trackerFetch(recorded.projectItems.map(withoutStatus)),
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
	test("a project ticket with no status carries assignees, blocks, a created time and a closed time", async () => {
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
				key: "AbysmalBiscuit/project-flow#17",
				statusType: "done",
				enteredStateAt: "2026-10-18T16:25:24Z",
				assignees: ["AbysmalBiscuit"],
				blocks: undefined,
			},
			{
				key: "AbysmalBiscuit/project-flow#383",
				statusType: "backlog",
				enteredStateAt: "2026-10-23T05:39:54Z",
				assignees: undefined,
				blocks: [
					"AbysmalBiscuit/project-flow#400",
					"AbysmalBiscuit/project-flow#399",
				],
			},
		]);
	});

	test("a ticket from a project and from its repo give the same ticket view", async () => {
		const fromProject = await ticketsOf(projectPin, board);
		const fromRepo = await ticketsOf(repoPin, repo);
		expect(fromProject).toHaveLength(recorded.repoIssues.length);
		expect(fromProject).toEqual(fromRepo);
	});

	test("a later page of blocked tickets reaches the project ticket", async () => {
		const sent: string[] = [];
		const open = recorded.projectItems.find(
			(item) => item.content.state === "OPEN",
		);
		if (open === undefined) {
			throw new Error("the recording has no open project item");
		}
		const paged = withoutStatus({
			...open,
			content: { ...open.content, blocking: recorded.blockingFirstPage },
		});
		const tickets = await ticketsOf(
			projectPin,
			board,
			trackerFetch([paged], sent),
		);
		expect(tickets[0]?.blocks?.map((ref) => ref.key)).toEqual([
			"AbysmalBiscuit/project-flow#400",
			"AbysmalBiscuit/project-flow#399",
		]);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain(recorded.blockingFirstPage.pageInfo.endCursor);
	});
});
