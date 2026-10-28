import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import { tempConfig, testIo } from "./support/app.ts";
import { trackerRequest } from "./support/fetch.ts";
import { recordedViewer, unrecorded } from "./support/github.ts";
import { readOverview, settledOverview } from "./support/reads.ts";

type Sent = {
	operation: string;
	query: string;
	variables: Record<string, unknown>;
};

type Answer = (sent: Sent, earlier: Sent[]) => unknown;

const refused = {
	errors: [
		{
			type: "RESOURCE_LIMITS_EXCEEDED",
			message: "Resource limits for this query exceeded.",
		},
	],
};

const issueIds = ["issue:acme/widget#101", "issue:acme/widget#102"];
const pullIds = ["pull:acme/widget#1", "pull:acme/widget#2"];
const mergedId = "pull:acme/widget#90";

/**
 * The recorded `acme/widget` read with each PR at `pullUpdatedAt`. An
 * incremental read lists no issue, as GitHub does when none changed.
 */
function repoRead(sent: Sent, pullUpdatedAt = "2026-08-18T11:00:00Z") {
	const body = structuredClone(recordedRepoRead);
	for (const pull of [
		...body.data.repository.openPullRequests.nodes,
		...body.data.repository.mergedPullRequests.nodes,
	]) {
		Object.assign(pull, { updatedAt: pullUpdatedAt });
	}
	if (sent.variables.since !== null && sent.variables.since !== undefined) {
		body.data.repository.issues.nodes = [];
	}
	return body;
}

/** The repo read that lists issues and PRs, not the auto-merge read. */
function listsRepo(sent: Sent): boolean {
	return sent.operation === "RepoRead" && sent.query.includes("issues(");
}

function ofOperation(sent: Sent[], operation: string): Sent[] {
	return sent.filter((item) => item.operation === operation);
}

/**
 * Starts the app on the recorded `acme/widget` repo read, runs the given number
 * of polls and returns the last overview with every GitHub GraphQL query sent.
 */
async function poll(
	answer: Answer,
	polls = 1,
): Promise<{ overview: Overview; sent: Sent[] }> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-repo-poll-"));
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ pinned: [{ tracker: "github", repo: "acme/widget" }] }),
	);
	const sent: Sent[] = [];
	const fetchImpl: Fetch = async (input, init) => {
		const viewer = recordedViewer(input, init);
		if (viewer !== null) {
			return viewer;
		}
		const request = trackerRequest(input, init);
		if (request.url !== "https://api.github.com/graphql") {
			return unrecorded(input, init);
		}
		const operation = request.query.match(/^\s*query\s+(\w+)/)?.[1] ?? "";
		const query = {
			operation,
			query: request.query,
			variables: request.variables,
		};
		const earlier = [...sent];
		sent.push(query);
		const body =
			answer(query, earlier) ??
			(operation === "RepoRead" ? repoRead(query) : undefined);
		if (body instanceof Response) {
			return body;
		}
		return body === undefined
			? new Response("not recorded", { status: 404 })
			: Response.json(body);
	};
	let finish: (overview: Overview) => void = () => {};
	let fail: (error: unknown) => void = () => {};
	const done = new Promise<Overview>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const check = async (base: string) => {
		let overview = await settledOverview(base, readOverview<Overview>);
		for (let count = 1; count < polls; count += 1) {
			await fetch(new URL("/api/refresh", base), { method: "POST" });
			await Bun.sleep(50);
			overview = await settledOverview(base, readOverview<Overview>);
		}
		return overview;
	};
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				listTodos: async () => "",
				stdout: (base) => {
					check(base).then(finish, fail);
				},
				waitForStop: done.then(() => undefined),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		return { overview: await done, sent };
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

/** Names each connection of 100 or more that sits inside another one. */
function nestedHundreds(query: string): string[] {
	const found: string[] = [];
	const open: { name: string; size: number }[] = [];
	for (const match of query.matchAll(/(\w+)\s*(\([^)]*\))?\s*\{|\}/g)) {
		if (match[0] === "}") {
			open.pop();
			continue;
		}
		const name = match[1] ?? "";
		const size = Number(
			(match[2] ?? "").match(/\b(?:first|last):\s*(\d+)/)?.[1] ?? 0,
		);
		const outer = open.filter((item) => item.size >= 100);
		if (size >= 100 && outer.length > 0) {
			found.push([...outer.map((item) => item.name), name].join(" > "));
		}
		open.push({ name, size });
	}
	return found;
}

function widget(overview: Overview) {
	return overview.projects.find((project) => project.name === "acme/widget");
}

/** A recorded read whose PR 1 has a second page of reviews. */
function pagedReviews(sent: Sent, pullUpdatedAt?: string) {
	const body = repoRead(sent, pullUpdatedAt);
	const pull = body.data.repository.openPullRequests.nodes[0];
	if (pull !== undefined) {
		Object.assign(pull, {
			reviews: {
				nodes: [],
				pageInfo: { hasNextPage: true, endCursor: "review-2" },
			},
		});
	}
	return body;
}

const secondReviewPage = {
	data: {
		c0: {
			reviews: {
				nodes: [
					{
						author: { login: "lev" },
						commit: { oid: "later" },
						state: "COMMENTED",
					},
				],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	},
};

describe("repo poll queries", () => {
	test("no poll query nests a connection of 100 inside a connection of 100", async () => {
		const { overview, sent } = await poll((item) =>
			item.operation === "RepoPages" ? secondReviewPage : undefined,
		);
		expect(sent.flatMap((item) => nestedHundreds(item.query))).toEqual([]);
		expect(widget(overview)?.error).toBeNull();
		expect(sent.map((item) => item.operation)).toEqual([
			"RepoRead",
			"RepoLists",
		]);
		const lists = ofOperation(sent, "RepoLists")[0];
		expect(lists?.query).toContain("full: nodes(ids: $full)");
		expect(lists?.variables).toEqual({
			full: [...issueIds, ...pullIds, mergedId],
			live: [...pullIds, mergedId],
		});
	});

	test("the continuation pages of many items go in one RepoPages read", async () => {
		const { overview, sent } = await poll((item) => {
			if (listsRepo(item)) {
				const body = pagedReviews(item);
				for (const pull of body.data.repository.openPullRequests.nodes) {
					Object.assign(pull, {
						reviews: {
							nodes: [],
							pageInfo: { hasNextPage: true, endCursor: "review-2" },
						},
					});
				}
				return body;
			}
			if (item.operation === "RepoPages") {
				const page = secondReviewPage.data.c0;
				return { data: { c0: page, c1: page } };
			}
			return undefined;
		});
		expect(widget(overview)?.error).toBeNull();
		const pages = ofOperation(sent, "RepoPages");
		expect(pages).toHaveLength(1);
		expect(pages[0]?.variables).toEqual({
			id0: pullIds[0],
			after0: "review-2",
			id1: pullIds[1],
			after1: "review-2",
		});
		expect(sent.flatMap((item) => nestedHundreds(item.query))).toEqual([]);
	});

	test("a later poll reads the lists of an item again only when its updatedAt changed", async () => {
		let reads = 0;
		const { sent } = await poll((item) => {
			if (!listsRepo(item)) {
				return undefined;
			}
			reads += 1;
			return repoRead(
				item,
				reads === 1 ? "2026-08-18T11:00:00Z" : "2026-08-18T11:30:00Z",
			);
		}, 3);
		expect(
			ofOperation(sent, "RepoLists").map((item) => item.variables),
		).toEqual([
			{
				full: [...issueIds, ...pullIds, mergedId],
				live: [...pullIds, mergedId],
			},
			{ full: [...pullIds, mergedId], live: [...pullIds, mergedId] },
			{ full: [], live: pullIds },
		]);
	});

	test("a repo read that GitHub refuses for its cost retries once with half the page size", async () => {
		const { overview, sent } = await poll((item, earlier) =>
			listsRepo(item) && !earlier.some(listsRepo) ? refused : undefined,
		);
		const reads = sent.filter(listsRepo);
		expect(reads).toHaveLength(2);
		expect(reads[0]?.query).toContain("issues(first: 100");
		expect(reads[1]?.query).toContain("issues(first: 50");
		expect(reads[1]?.query).toContain("pullRequests(first: 50");
		expect(widget(overview)?.error).toBeNull();
		expect(widget(overview)?.tickets.map((ticket) => ticket.key)).toEqual([
			"acme/widget#101",
			"acme/widget#102",
		]);
	});

	test("a list read that GitHub refuses for its cost retries once with half the page size", async () => {
		const { overview, sent } = await poll((item, earlier) =>
			item.operation === "RepoLists" &&
			ofOperation(earlier, "RepoLists").length === 0
				? refused
				: undefined,
		);
		const lists = ofOperation(sent, "RepoLists");
		expect(lists).toHaveLength(2);
		expect(lists[0]?.query).toContain("comments(first: 100");
		expect(lists[1]?.query).toContain("comments(first: 50");
		expect(widget(overview)?.error).toBeNull();
	});

	test("a continuation page that GitHub refuses after a first page retries once with half the page size", async () => {
		const { overview, sent } = await poll((item, earlier) => {
			if (listsRepo(item)) {
				return pagedReviews(item);
			}
			if (item.operation !== "RepoPages") {
				return undefined;
			}
			return ofOperation(earlier, "RepoPages").length === 0
				? refused
				: secondReviewPage;
		});
		const pages = ofOperation(sent, "RepoPages");
		expect(pages).toHaveLength(2);
		expect(pages[0]?.query).toContain("reviews(first: 100, after: $after0)");
		expect(pages[1]?.query).toContain("reviews(first: 50, after: $after0)");
		expect(widget(overview)?.error).toBeNull();
	});

	test("a repo read that GitHub refuses twice reports the failure", async () => {
		const { overview, sent } = await poll(
			(item, earlier) =>
				listsRepo(item) && earlier.some(listsRepo) ? refused : undefined,
			2,
		);
		expect(sent.filter(listsRepo)).toHaveLength(3);
		expect(widget(overview)?.error).toContain(
			"Resource limits for this query exceeded",
		);
	});

	test("a list read with a missing node fails the poll and keeps the stored rows", async () => {
		const { overview } = await poll(
			(item, earlier) =>
				item.operation === "RepoLists" &&
				ofOperation(earlier, "RepoLists").length > 0
					? {
							data: { full: [null], live: [null] },
							errors: [{ message: "Could not resolve to a node" }],
						}
					: undefined,
			2,
		);
		expect(widget(overview)?.error).toContain("Could not resolve to a node");
		expect(widget(overview)?.tickets.map((ticket) => ticket.key)).toEqual([
			"acme/widget#101",
			"acme/widget#102",
		]);
	});

	test("a continuation page that fails fails the poll", async () => {
		const { overview } = await poll((item, earlier) => {
			if (listsRepo(item)) {
				return earlier.some(listsRepo)
					? pagedReviews(item, "2026-08-18T11:30:00Z")
					: undefined;
			}
			return item.operation === "RepoPages"
				? new Response("recorded failure", { status: 500 })
				: undefined;
		}, 2);
		expect(widget(overview)?.error).toContain("HTTP 500");
	});

	test("an error on one PR's page skips that PR, and the next poll reads only it again", async () => {
		const { overview, sent } = await poll((item, earlier) => {
			if (listsRepo(item)) {
				return pagedReviews(item);
			}
			if (item.operation !== "RepoPages") {
				return undefined;
			}
			return ofOperation(earlier, "RepoPages").length === 0
				? {
						data: { c0: null },
						errors: [{ message: "recorded broken PR", path: ["c0"] }],
					}
				: secondReviewPage;
		}, 2);
		expect(widget(overview)?.error).toBeNull();
		const lists = ofOperation(sent, "RepoLists").map((item) => item.variables);
		expect(lists[1]).toEqual({ full: [pullIds[0]], live: pullIds });
		expect(ofOperation(sent, "RepoPages")).toHaveLength(2);
	});

	test("the poll after a failed continuation page reads those lists again", async () => {
		const { overview, sent } = await poll((item, earlier) => {
			if (listsRepo(item)) {
				return earlier.some(listsRepo)
					? pagedReviews(item, "2026-08-18T11:30:00Z")
					: undefined;
			}
			if (item.operation !== "RepoPages") {
				return undefined;
			}
			return ofOperation(earlier, "RepoPages").length === 0
				? new Response("recorded failure", { status: 500 })
				: secondReviewPage;
		}, 3);
		expect(widget(overview)?.error).toBeNull();
		const lists = ofOperation(sent, "RepoLists").map((item) => item.variables);
		expect(lists[1]?.full).toEqual([...pullIds, mergedId]);
		expect(lists[2]?.full).toEqual([...pullIds, mergedId]);
		expect(ofOperation(sent, "RepoPages")).toHaveLength(2);
	});
});
