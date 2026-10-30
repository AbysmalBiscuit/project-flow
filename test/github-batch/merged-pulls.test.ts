import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { trackerRequest } from "../support/fetch.ts";
import { readOverview, settledOverview } from "../support/reads.ts";
import {
	type Connection,
	type GraphqlRequest,
	membership,
	operationName,
	renamed,
	type RepoBody,
} from "./_support.ts";

type TicketView = { key: string; pullUrl?: string; statusType?: string };
type ProjectTickets = { tickets: TicketView[]; doneTickets: TicketView[] };

const closedKey = "acme/widget#103";
const mergedUrl = "https://github.com/acme/widget/pull/90";
const mergedId = "PR_90";
const fullPollGapMs = 11 * 60 * 1000;

type Poll = {
	/** The number of the repo read, from 1. */
	read: number;
	repository: RepoBody["data"]["repository"];
};

/**
 * Serves the recorded repo read with a closed ticket #103. The first read
 * lists merged PR #90 as the PR that closes #103. `edit` changes each read.
 */
function closedTicketRead(edit: (poll: Poll) => void) {
	let reads = 0;
	return (owner: string, name: string, request: GraphqlRequest) => {
		const body = renamed(owner, name);
		if (operationName(request.query) !== "RepoRead") {
			return body;
		}
		reads += 1;
		const repository = body.data.repository;
		const closed = structuredClone(repository.issues.nodes[0] ?? {});
		closed.id = "I_103";
		closed.number = 103;
		closed.title = "Ticket 103";
		closed.state = "CLOSED";
		closed.updatedAt = "2026-01-01T00:00:00.000Z";
		repository.issues.nodes.push(closed);
		const merged = repository.mergedPullRequests.nodes[0];
		if (merged !== undefined) {
			merged.id = mergedId;
			merged.body = "Closes #103";
			const closing = merged.closingIssuesReferences as Connection<{
				number: number;
			}>;
			closing.nodes = [{ number: 103 }];
		}
		if (reads > 1) {
			repository.mergedPullRequests.nodes = [];
		}
		edit({ read: reads, repository });
		return body;
	};
}

type App = {
	/** Each request that the app sent, with its GraphQL body. */
	sent: () => GraphqlRequest[];
	project: () => Promise<ProjectTickets>;
	overview: () => Promise<Overview>;
	/**
	 * Moves the clock by `ms`, refreshes, and waits for the poll to settle.
	 * Returns each request that the poll sent, with its GraphQL body.
	 */
	poll: (ms: number) => Promise<GraphqlRequest[]>;
};

async function withApp(
	read: ReturnType<typeof closedTicketRead>,
	check: (app: App) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			tracked: [{ tracker: "github", repo: "acme/widget" }],
			pollIntervalSeconds: 3600,
		}),
	);
	const requests: GraphqlRequest[] = [];
	const answer = membership([], read);
	let clock = Date.parse("2026-08-18T12:00:00.000Z");
	let releaseReady: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		releaseReady = resolve;
	});
	let stop = () => {};
	const stopped = new Promise<void>((resolve) => {
		stop = resolve;
	});
	try {
		let base = "";
		const running = run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: (input, init) => {
					requests.push(trackerRequest(input, init));
					return answer(input, init);
				},
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date(clock),
				stdout: (line) => {
					base = line;
					releaseReady();
				},
				waitForStop: stopped,
			}),
		);
		await ready;
		await check({
			sent: () => [...requests],
			project: async () =>
				(await (
					await fetch(new URL("/api/projects/acme%2Fwidget", base))
				).json()) as ProjectTickets,
			overview: () => readOverview<Overview>(base),
			poll: async (ms) => {
				const before = requests.length;
				clock += ms;
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await settledOverview(base, readOverview<Overview>);
				return requests.slice(before);
			},
		});
		stop();
		await running;
	} finally {
		stop();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

const pullUrlOf = (body: ProjectTickets) =>
	body.doneTickets.find((ticket) => ticket.key === closedKey)?.pullUrl;

const repoReadsSince = (requests: GraphqlRequest[]) =>
	requests
		.filter((request) => operationName(request.query) === "RepoRead")
		.map((request) => request.variables.since ?? null);

/** The requests that name merged PR #90 by its node id, URL or number. */
const mergedPullRequests = (requests: GraphqlRequest[]) =>
	requests.filter((request) => {
		const sent = JSON.stringify(request);
		return (
			sent.includes(mergedId) ||
			/\/pulls?\/90\b/.test(sent) ||
			request.variables.number === 90
		);
	});

describe("merged pulls across full polls", () => {
	test("a full poll keeps a stored merged PR that its merged page left out, with no request for it", async () => {
		await withApp(
			closedTicketRead(() => {}),
			async (app) => {
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				expect(mergedPullRequests(app.sent())).not.toEqual([]);
				const later = await app.poll(fullPollGapMs);
				expect(repoReadsSince(later)).toEqual([null]);
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				expect(mergedPullRequests(later)).toEqual([]);
			},
		);
	});

	test("an incremental poll that returns the updated closed ticket keeps its merged PR for the next full poll", async () => {
		await withApp(
			closedTicketRead(({ read, repository }) => {
				const closed = repository.issues.nodes.find(
					(issue) => issue.number === 103,
				);
				if (closed !== undefined && read > 1) {
					closed.updatedAt = `2026-08-18T12:0${read}:00.000Z`;
				}
			}),
			async (app) => {
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				const incremental = await app.poll(60 * 1000);
				expect(repoReadsSince(incremental)).toHaveLength(1);
				expect(repoReadsSince(incremental)).not.toContain(null);
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				expect(mergedPullRequests(incremental)).toEqual([]);
				const full = await app.poll(fullPollGapMs);
				expect(repoReadsSince(full)).toEqual([null]);
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				expect(mergedPullRequests(full)).toEqual([]);
			},
		);
	});

	test("a reopened ticket whose merged closing PR is only in the store stays open", async () => {
		await withApp(
			closedTicketRead(({ read, repository }) => {
				const ticket = repository.issues.nodes.find(
					(issue) => issue.number === 103,
				);
				if (ticket !== undefined && read > 1) {
					ticket.state = "OPEN";
					ticket.stateReason = "REOPENED";
					ticket.closedAt = null;
					ticket.updatedAt = "2026-08-18T12:11:00.000Z";
				}
			}),
			async (app) => {
				expect(pullUrlOf(await app.project())).toBe(mergedUrl);
				await app.poll(fullPollGapMs);
				const body = await app.project();
				expect(body.doneTickets.map((ticket) => ticket.key)).not.toContain(
					closedKey,
				);
				const reopened = body.tickets.find(
					(ticket) => ticket.key === closedKey,
				);
				expect(reopened?.statusType).not.toBe("done");
			},
		);
	});

	test("a bot that only a stored merged PR shows is not an expected bot of an open PR", async () => {
		await withApp(
			closedTicketRead(() => {}),
			async (app) => {
				const before = (await app.overview()).projects[0];
				await app.poll(fullPollGapMs);
				const after = (await app.overview()).projects[0];
				expect(before?.inReview).toBeGreaterThan(0);
				expect(after?.inReview).toBe(0);
			},
		);
	});
});
