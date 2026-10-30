import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedClosed from "./fixtures/github-closed-issues.json";
import recordedOpen from "./fixtures/github-issues.json";
import recordedParent from "./fixtures/github-parent-issue.json";
import { tempConfig, testIo } from "./support/app.ts";
import { type TrackerRequest, trackerRequest, urlOf } from "./support/fetch.ts";
import {
	emptyProjectFields,
	githubSince,
	recordedDiscovery,
	unrecorded,
} from "./support/github.ts";
import { readOverview, settledOverview } from "./support/reads.ts";
import { githubIssueNode, repoReadIssues } from "./support/repo-read.ts";

const owner = "AbysmalBiscuit";
const repoName = `${owner}/project-flow`;
const boardId = "PVT_claimed_close";
const boardTitle = "Claimed board";

type Issue = Record<string, unknown>;

function recorded(number: number): Issue {
	const found = [...recordedClosed.issues, ...recordedOpen].find(
		(item) => item.number === number && item.state === "closed",
	);
	if (found === undefined) {
		throw new Error(`recorded closed #${number} is missing`);
	}
	return found;
}

/** The recorded issue as it stood before it closed. */
function reopened(item: Issue): Issue {
	return {
		...item,
		state: "open",
		state_reason: null,
		closed_at: null,
		updated_at: item.created_at,
	};
}

const open205 = recordedOpen[0];
if (open205 === undefined) {
	throw new Error("recorded open #205 is missing");
}
const closed205 = recorded(205);
const closed380 = recorded(380);
const open380 = reopened(closed380);
const closedParent: Issue = recordedParent.parent;
const openParent: Issue = {
	...reopened(closedParent),
	updated_at: "2026-10-19T17:13:52Z",
};
const subIssues: Issue[] = recordedParent.subIssues;
const closedBlockerOf391 = recordedClosed.blockedBy391;
const openBlockerOf391 = closedBlockerOf391.map((row) => ({
	...row,
	state: "open",
}));
const open391 = (blockers: Issue[]) => ({
	...reopened(recorded(391)),
	dependencyRows: blockers,
});

/** What GitHub answers now. A `null` board answers each board read with 502. */
type TrackerIssues = { repo: Issue[]; board: Issue[] | null };

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

function trackerFetch(
	tracker: TrackerIssues,
	requests: TrackerRequest[],
): Fetch {
	return async (input, init) => {
		requests.push(trackerRequest(input, init));
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const blockedBy = url.match(
			/\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/dependencies\/blocked_by/,
		);
		if (blockedBy !== null) {
			const item = tracker.repo.find(
				(entry) => String(entry.number) === blockedBy[1],
			);
			return Response.json(item?.dependencyRows ?? []);
		}
		if (url !== "https://api.github.com/graphql") {
			return unrecorded(input, init);
		}
		if (body.includes("query HeldIssues")) {
			const repository = Object.fromEntries(
				[...body.matchAll(/i(\d+): issue\(number: (\d+)\)/g)].map((match) => {
					const item = tracker.repo.find(
						(entry) => String(entry.number) === match[2],
					);
					return [
						`i${match[1]}`,
						item === undefined ? null : githubIssueNode(item),
					];
				}),
			);
			return Response.json({ data: { repository } });
		}
		if (body.includes("query RepoRead")) {
			const since =
				(JSON.parse(body) as { variables?: { since?: string | null } })
					.variables?.since ?? null;
			const nodes = tracker.repo
				.filter(
					(item) =>
						since === null ||
						Date.parse(String(item.updated_at)) >= Date.parse(since),
				)
				.map((item) => githubIssueNode(item));
			return Response.json(repoReadIssues(owner, "project-flow", nodes));
		}
		if (body.includes("ProjectByNumber")) {
			return Response.json({
				data: {
					repositoryOwner: {
						projectV2: {
							id: boardId,
							number: 4,
							title: boardTitle,
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
			if (tracker.board === null) {
				return new Response("bad gateway", { status: 502 });
			}
			return Response.json({
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

/** The `since` cursor of each repo read the app sent, in order. */
function repoReadSince(requests: TrackerRequest[]): unknown[] {
	return requests
		.filter((request) => request.query.includes("query RepoRead"))
		.map((request) => request.variables.since ?? null);
}

/** The issue numbers that each held issue read asked for, in order. */
function heldIssueReads(requests: TrackerRequest[]): number[][] {
	return requests
		.filter((request) => request.query.includes("query HeldIssues"))
		.map((request) =>
			[...request.query.matchAll(/issue\(number: (\d+)\)/g)].map((match) =>
				Number(match[1]),
			),
		);
}

type Clock = { now: Date };

/** The ticket that the project report of the tracked repo shows. */
async function projectCopy(base: string, number: number) {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(repoName)}`, base),
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		tickets: { key: string | null }[];
	};
	return body.tickets.find((ticket) => ticket.key === `${repoName}#${number}`);
}

type App = {
	base: string;
	overview: () => Promise<Overview>;
	refresh: (at: string) => Promise<Overview>;
	stop: () => Promise<void>;
};

async function startApp(
	paths: { config: string; database: string },
	tracker: TrackerIssues,
	requests: TrackerRequest[],
	clock: Clock,
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
		["--config", paths.config, "--host", "127.0.0.1", "--port", "0"],
		testIo({
			env: { GITHUB_TOKEN: "recorded-token" },
			fetch: trackerFetch(tracker, requests),
			readGhToken: async () => null,
			databasePath: paths.database,
			stdout: ready,
			waitForStop: stopped,
			now: () => clock.now,
		}),
	);
	const base = await opened;
	return {
		base,
		overview: () => settledOverview(base, readOverview<Overview>),
		async refresh(at) {
			const before = await settledOverview(base, readOverview<Overview>);
			clock.now = new Date(at);
			const response = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(response.status).toBe(204);
			while (true) {
				const body = await settledOverview(base, readOverview<Overview>);
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

const boardPin = { tracker: "github", owner, project: 4 };
const repoPin = { tracker: "github", repo: repoName };

async function withTrackedBoardAndRepo(
	check: (paths: { config: string; database: string }) => Promise<void>,
	pinned = [boardPin, repoPin],
): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned, pollIntervalSeconds: 3600 }),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-claimed-close-"));
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

const beforeClose = "2026-10-20T21:50:00.000Z";
const afterClose = "2026-10-20T21:55:00.000Z";

describe("a GitHub issue that closes after the app stored it as open", () => {
	test("shows in Done after the next poll, also when a tracked board lists it", async () => {
		await withTrackedBoardAndRepo(async (paths) => {
			const tracker: TrackerIssues = { repo: [open205], board: [] };
			const requests: TrackerRequest[] = [];
			const app = await startApp(paths, tracker, requests, {
				now: new Date(beforeClose),
			});
			try {
				expect(copiesOf(await app.overview(), 205)).toEqual([
					{ project: repoName, lane: "Backlog", blockers: [] },
				]);
				tracker.repo = [closed205];
				tracker.board = [closed205];
				expect(copiesOf(await app.refresh(afterClose), 205)).toEqual([
					{ project: boardTitle, lane: "Done", blockers: [] },
				]);
				expect(repoReadSince(requests)).toEqual([
					null,
					githubSince(beforeClose),
				]);
			} finally {
				await app.stop();
			}
		});
	});

	test("shows in Done when the board read fails and the repo read returns the close", async () => {
		await withTrackedBoardAndRepo(async (paths) => {
			const tracker: TrackerIssues = { repo: [open205], board: [open205] };
			const requests: TrackerRequest[] = [];
			const app = await startApp(paths, tracker, requests, {
				now: new Date(beforeClose),
			});
			try {
				expect(copiesOf(await app.overview(), 205)).toEqual([
					{ project: boardTitle, lane: "Backlog", blockers: [] },
				]);
				tracker.repo = [closed205];
				tracker.board = null;
				const sent = requests.length;
				expect(copiesOf(await app.refresh(afterClose), 205)).toEqual([
					{ project: repoName, lane: "Done", blockers: [] },
				]);
				expect(
					requests
						.slice(sent)
						.some((request) => request.query.includes("node(id:")),
				).toBe(true);
				expect(repoReadSince(requests)).toEqual([
					null,
					githubSince(beforeClose),
				]);
				tracker.board = [closed205];
				expect(
					copiesOf(await app.refresh("2026-10-21T10:00:00.000Z"), 205),
				).toEqual([{ project: boardTitle, lane: "Done", blockers: [] }]);
			} finally {
				await app.stop();
			}
		});
	});

	test("a ticket whose only blocker closed shows no Blocked chip after the next poll", async () => {
		await withTrackedBoardAndRepo(
			async (paths) => {
				const tracker: TrackerIssues = {
					repo: [open380, open391(openBlockerOf391)],
					board: [open391(openBlockerOf391)],
				};
				const requests: TrackerRequest[] = [];
				const app = await startApp(paths, tracker, requests, {
					now: new Date("2026-10-23T14:20:00.000Z"),
				});
				try {
					const before = copiesOf(await app.overview(), 391);
					expect(before).toHaveLength(1);
					expect(before[0]?.blockers).not.toEqual([]);
					tracker.repo = [closed380, open391(closedBlockerOf391)];
					tracker.board = [closed380, open391(closedBlockerOf391)];
					expect(
						copiesOf(await app.refresh("2026-10-23T14:28:00.000Z"), 391),
					).toEqual([{ project: boardTitle, lane: "Backlog", blockers: [] }]);
					expect(repoReadSince(requests)).toEqual([
						null,
						githubSince("2026-10-23T14:20:00.000Z"),
					]);
				} finally {
					await app.stop();
				}
			},
			[repoPin, boardPin],
		);
	});

	test("the project report takes updatedAt and enteredStateAt from the closed issue when a poll after its close stamp still read it open", async () => {
		await withTrackedBoardAndRepo(
			async (paths) => {
				const tracker: TrackerIssues = {
					repo: [reopened(closed205)],
					board: [],
				};
				const requests: TrackerRequest[] = [];
				const app = await startApp(paths, tracker, requests, {
					now: new Date(Date.parse(String(closed205.closed_at)) + 30 * 1000),
				});
				try {
					await app.overview();
					expect(await projectCopy(app.base, 205)).toMatchObject({
						state: "backlog",
						updatedAt: closed205.created_at,
						enteredStateAt: closed205.created_at,
					});
					tracker.repo = [closed205];
					await app.refresh(afterClose);
					expect(await projectCopy(app.base, 205)).toMatchObject({
						state: "done",
						updatedAt: closed205.updated_at,
						enteredStateAt: closed205.closed_at,
					});
				} finally {
					await app.stop();
				}
			},
			[repoPin],
		);
	});

	test("a parent issue with sub-issues that a poll read open after its close shows as done after the next poll", async () => {
		await withTrackedBoardAndRepo(
			async (paths) => {
				const tracker: TrackerIssues = {
					repo: [openParent, ...subIssues],
					board: [],
				};
				const requests: TrackerRequest[] = [];
				const app = await startApp(paths, tracker, requests, {
					now: new Date(
						Date.parse(String(closedParent.closed_at)) + 10 * 60 * 1000,
					),
				});
				try {
					await app.overview();
					expect(await projectCopy(app.base, 1)).toMatchObject({
						state: "backlog",
						updatedAt: openParent.updated_at,
					});
					tracker.repo = [closedParent, ...subIssues];
					await app.refresh("2026-10-25T08:45:00.000Z");
					expect(await projectCopy(app.base, 1)).toMatchObject({
						state: "done",
						updatedAt: closedParent.updated_at,
					});
					expect(heldIssueReads(requests)).toEqual([[1]]);
				} finally {
					await app.stop();
				}
			},
			[repoPin],
		);
	});

	test("an app restart with an existing store shows the closed state of an issue that closed while the app was stopped", async () => {
		await withTrackedBoardAndRepo(async (paths) => {
			const tracker: TrackerIssues = { repo: [open205], board: [] };
			const requests: TrackerRequest[] = [];
			const clock: Clock = { now: new Date(beforeClose) };
			const first = await startApp(paths, tracker, requests, clock);
			try {
				expect(copiesOf(await first.overview(), 205)).toEqual([
					{ project: repoName, lane: "Backlog", blockers: [] },
				]);
			} finally {
				await first.stop();
			}
			tracker.repo = [closed205];
			tracker.board = [closed205];
			clock.now = new Date(afterClose);
			const second = await startApp(paths, tracker, requests, clock);
			try {
				let body = await second.overview();
				while (body.fetchedAt !== afterClose) {
					await Bun.sleep(20);
					body = await second.overview();
				}
				expect(copiesOf(body, 205)).toEqual([
					{ project: boardTitle, lane: "Done", blockers: [] },
				]);
				expect(repoReadSince(requests)).toEqual([
					null,
					githubSince(beforeClose),
				]);
			} finally {
				await second.stop();
			}
		});
	});
});
