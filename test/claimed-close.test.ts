import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	githubIssueNode,
	recordedDiscovery,
	repoReadIssues,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const repoName = "acme/claimed";
const boardId = "PVT_claimed_close";
const openedAt = "2026-10-20T21:34:00Z";
const closedAt = "2026-10-20T21:52:37Z";

type Issue = Record<string, unknown>;

/** What GitHub answers now: the repo's issues and the issues on the board. */
type Tracker = { repo: Issue[]; board: Issue[] };

function issue(
	number: number,
	state: "open" | "closed",
	extra: Issue = {},
): Issue {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: state === "closed" ? closedAt : openedAt,
		closed_at: state === "closed" ? closedAt : null,
		html_url: `https://github.com/${repoName}/issues/${number}`,
		...extra,
	};
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function boardItem(item: Issue): Issue {
	const { comments: _comments, ...node } = githubIssueNode(item);
	return {
		content: {
			__typename: "Issue",
			id: `I_${String(item.number)}`,
			...node,
			comments: { totalCount: 0 },
			repository: { nameWithOwner: repoName },
		},
	};
}

function blockerStates(body: string, tracker: Tracker): Response {
	const parsed = JSON.parse(body) as { query: string };
	const asked = [...parsed.query.matchAll(/i(\d+): issue\(number: (\d+)\)/g)];
	const repository: Record<string, unknown> = {};
	for (const [, index, number] of asked) {
		const node = tracker.repo.find((item) => String(item.number) === number);
		const blockedBy =
			node === undefined
				? []
				: (githubIssueNode(node).blockedBy as { nodes: unknown[] }).nodes;
		repository[`i${index}`] = {
			blockedBy: {
				nodes: blockedBy,
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		};
	}
	return json({ data: { repository } });
}

function trackerFetch(tracker: Tracker): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		if (url !== "https://api.github.com/graphql") {
			return unrecorded(input, init);
		}
		if (body.includes("query RepoRead")) {
			const since =
				(JSON.parse(body) as { variables?: { since?: string | null } })
					.variables?.since ?? null;
			const nodes = tracker.repo
				.filter((item) => since === null || String(item.updated_at) >= since)
				.map((item) => githubIssueNode(item));
			return json(repoReadIssues("acme", "claimed", nodes));
		}
		if (body.includes("query BlockerStates")) {
			return blockerStates(body, tracker);
		}
		if (body.includes("ProjectByNumber")) {
			return json({
				data: {
					repositoryOwner: {
						projectV2: {
							id: boardId,
							number: 4,
							title: "Claimed board",
							closed: false,
							updatedAt: "2026-10-18T15:08:25Z",
						},
					},
				},
			});
		}
		if (body.includes("ProjectFields")) {
			return emptyProjectFields(input, init) ?? unrecorded(input, init);
		}
		if (body.includes("node(id:")) {
			return json({
				data: {
					node: {
						items: {
							nodes: tracker.board.map(boardItem),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		return unrecorded(input, init);
	};
}

async function readOverview(base: string): Promise<Overview> {
	return (await (
		await fetch(new URL("/api/overview", base))
	).json()) as Overview;
}

/** Each copy of the ticket that the overview shows, with its project. */
function copiesOf(body: Overview, number: number) {
	return body.projects.flatMap((project) =>
		project.tickets
			.filter((ticket) => ticket.key === `${repoName}#${number}`)
			.map((ticket) => ({
				project: project.name,
				lane: ticket.lane,
				blockers: ticket.blockers,
			})),
	);
}

type App = {
	overview: () => Promise<Overview>;
	refresh: () => Promise<Overview>;
	stop: () => Promise<void>;
};

async function startApp(
	configPath: string,
	databasePath: string,
	tracker: Tracker,
): Promise<App> {
	let stop: () => void = () => {};
	const stopped = new Promise<void>((resolve) => {
		stop = resolve;
	});
	let ready: (base: string) => void = () => {};
	const opened = new Promise<string>((resolve) => {
		ready = resolve;
	});
	const started = run(
		["--config", configPath, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: trackerFetch(tracker),
			readGhToken: async () => null,
			databasePath,
			stdout: ready,
			waitForStop: stopped,
		}),
	);
	const base = await opened;
	return {
		overview: () => settledOverview(base, readOverview),
		async refresh() {
			const before = await settledOverview(base, readOverview);
			const response = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(response.status).toBe(204);
			while (true) {
				const body = await settledOverview(base, readOverview);
				if (body.fetchedAt !== before.fetchedAt) {
					return body;
				}
				await Bun.sleep(20);
			}
		},
		async stop() {
			stop();
			await started;
		},
	};
}

const boardPin = { tracker: "github", owner: "acme", project: 4 };
const repoPin = { tracker: "github", repo: repoName };

async function withTrackedBoardAndRepo(
	check: (paths: { config: string; database: string }) => Promise<void>,
	pinned = [boardPin, repoPin],
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned, pollIntervalSeconds: 3600 }),
	);
	const root = await mkdtemp(join("/var/tmp", "project-flow-claimed-close-"));
	try {
		await check({
			config: path,
			database: join(root, "project-flow.sqlite"),
		});
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("a GitHub issue that closes after the app stored it as open", () => {
	test("shows in Done after the next poll, also when a tracked board lists it", async () => {
		await withTrackedBoardAndRepo(async ({ config, database }) => {
			const tracker: Tracker = { repo: [issue(9, "open")], board: [] };
			const app = await startApp(config, database, tracker);
			try {
				expect(copiesOf(await app.overview(), 9)).toEqual([
					{ project: repoName, lane: "Backlog", blockers: [] },
				]);
				tracker.repo = [issue(9, "closed")];
				tracker.board = [issue(9, "closed")];
				expect(copiesOf(await app.refresh(), 9)).toEqual([
					{ project: "Claimed board", lane: "Done", blockers: [] },
				]);
			} finally {
				await app.stop();
			}
		});
	});

	test("a ticket whose only blocker closed shows no Blocked chip after the next poll", async () => {
		await withTrackedBoardAndRepo(
			async ({ config, database }) => {
				const blocker = {
					number: 8,
					title: "Ticket 8",
					html_url: `https://github.com/${repoName}/issues/8`,
				};
				const openBlocker = {
					dependencyRows: [{ ...blocker, state: "open" }],
				};
				const closedBlocker = {
					dependencyRows: [{ ...blocker, state: "closed" }],
				};
				const tracker: Tracker = {
					repo: [issue(8, "open"), issue(9, "open", openBlocker)],
					board: [issue(9, "open", openBlocker)],
				};
				const app = await startApp(config, database, tracker);
				try {
					const before = copiesOf(await app.overview(), 9);
					expect(before).toHaveLength(1);
					expect(before[0]?.blockers).not.toEqual([]);
					tracker.repo = [issue(8, "closed"), issue(9, "open", closedBlocker)];
					tracker.board = [issue(8, "closed"), issue(9, "open", closedBlocker)];
					expect(copiesOf(await app.refresh(), 9)).toEqual([
						{ project: "Claimed board", lane: "Backlog", blockers: [] },
					]);
				} finally {
					await app.stop();
				}
			},
			[repoPin, boardPin],
		);
	});

	test("an app restart with an existing store shows the closed state of an issue that closed while the app was stopped", async () => {
		await withTrackedBoardAndRepo(async ({ config, database }) => {
			const tracker: Tracker = { repo: [issue(9, "open")], board: [] };
			const first = await startApp(config, database, tracker);
			let stored: string | null = null;
			try {
				const body = await first.overview();
				stored = body.fetchedAt;
				expect(copiesOf(body, 9)).toEqual([
					{ project: repoName, lane: "Backlog", blockers: [] },
				]);
			} finally {
				await first.stop();
			}
			tracker.repo = [issue(9, "closed")];
			tracker.board = [issue(9, "closed")];
			const second = await startApp(config, database, tracker);
			try {
				let body = await second.overview();
				while (body.fetchedAt === stored) {
					await Bun.sleep(20);
					body = await second.overview();
				}
				expect(copiesOf(body, 9)).toEqual([
					{ project: "Claimed board", lane: "Done", blockers: [] },
				]);
			} finally {
				await second.stop();
			}
		});
	});
});
