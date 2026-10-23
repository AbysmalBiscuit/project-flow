import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import {
	recordedViewer,
	settledOverview,
	tempConfig,
	testIo,
	trackerRequest,
	unrecorded,
} from "./support.ts";

type Sent = { operation: string; query: string };

type Answer = (sent: Sent, earlier: Sent[]) => unknown;

const refused = {
	errors: [
		{
			type: "RESOURCE_LIMITS_EXCEEDED",
			message: "Resource limits for this query exceeded.",
		},
	],
};

async function readOverview(base: string): Promise<Overview> {
	return (await (
		await fetch(new URL("/api/overview", base))
	).json()) as Overview;
}

function repoRead(pullUpdatedAt: string): unknown {
	const body = structuredClone(recordedRepoRead);
	for (const pull of [
		...body.data.repository.openPullRequests.nodes,
		...body.data.repository.mergedPullRequests.nodes,
	]) {
		Object.assign(pull, { updatedAt: pullUpdatedAt });
	}
	return body;
}

/** The repo read that lists issues and PRs, not the auto-merge read. */
function listsRepo(sent: Sent): boolean {
	return sent.operation === "RepoRead" && sent.query.includes("issues(");
}

/**
 * Starts the app on the recorded `acme/widget` repo read, runs the given number
 * of polls and returns the last overview with every GitHub GraphQL query sent.
 */
async function poll(
	answer: Answer,
	polls = 1,
): Promise<{ overview: Overview; sent: Sent[] }> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-repo-poll-"));
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
		const query = { operation, query: request.query };
		const earlier = [...sent];
		sent.push(query);
		const body = answer(query, earlier);
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
		let overview = await settledOverview(base, readOverview);
		for (let count = 1; count < polls; count += 1) {
			await fetch(new URL("/api/refresh", base), { method: "POST" });
			await Bun.sleep(50);
			overview = await settledOverview(base, readOverview);
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

const recordedAnswer: Answer = (sent) =>
	sent.operation === "RepoRead" ? repoRead("2026-08-18T11:00:00Z") : undefined;

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

describe("repo poll queries", () => {
	test("no poll query nests a connection of 100 inside a connection of 100", async () => {
		const { overview, sent } = await poll(recordedAnswer);
		expect(sent.flatMap((item) => nestedHundreds(item.query))).toEqual([]);
		expect(widget(overview)?.error).toBeNull();
		expect(sent.map((item) => item.operation)).toEqual([
			"RepoRead",
			"RepoLists",
		]);
		const lists = sent.find((item) => item.operation === "RepoLists");
		expect(lists?.query).toContain("i101: issue(number: 101)");
		expect(lists?.query).toContain("p1: pullRequest(number: 1)");
		expect(lists?.query).toContain("p90: pullRequest(number: 90)");
	});

	test("a second poll reads the lists of a PR again only when its updatedAt changed", async () => {
		let reads = 0;
		const { sent } = await poll((item) => {
			if (item.operation !== "RepoRead") {
				return undefined;
			}
			if (!listsRepo(item)) {
				return repoRead("2026-08-18T11:00:00Z");
			}
			reads += 1;
			return repoRead(
				reads === 1 ? "2026-08-18T11:00:00Z" : "2026-08-18T11:30:00Z",
			);
		}, 3);
		const lists = sent
			.filter((item) => item.operation === "RepoLists")
			.map((item) => item.query);
		expect(lists).toHaveLength(3);
		expect(lists[0]).toContain("p1: pullRequest(number: 1)");
		expect(lists[1]).toContain("p1: pullRequest(number: 1)");
		expect(lists[2]).not.toContain("pullRequest(");
		expect(lists[2]).toContain("i101: issue(number: 101)");
	});

	test("a repo read that GitHub refuses for its cost retries once with half the page size", async () => {
		const { overview, sent } = await poll((item, earlier) => {
			if (item.operation !== "RepoRead") {
				return undefined;
			}
			return !listsRepo(item) || earlier.some(listsRepo)
				? repoRead("2026-08-18T11:00:00Z")
				: refused;
		});
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
		const { overview, sent } = await poll((item, earlier) => {
			if (item.operation === "RepoRead") {
				return repoRead("2026-08-18T11:00:00Z");
			}
			if (
				item.operation === "RepoLists" &&
				!earlier.some((before) => before.operation === "RepoLists")
			) {
				return refused;
			}
			return undefined;
		});
		const lists = sent.filter((item) => item.operation === "RepoLists");
		expect(lists).toHaveLength(2);
		expect(lists[0]?.query).toContain("comments(first: 100");
		expect(lists[1]?.query).toContain("comments(first: 50");
		expect(widget(overview)?.error).toBeNull();
	});

	test("a repo read that GitHub refuses twice reports the failure", async () => {
		const { overview, sent } = await poll((item, earlier) => {
			if (item.operation !== "RepoRead") {
				return undefined;
			}
			return listsRepo(item) && earlier.some(listsRepo)
				? refused
				: repoRead("2026-08-18T11:00:00Z");
		}, 2);
		expect(sent.filter(listsRepo)).toHaveLength(3);
		expect(widget(overview)?.error).toContain(
			"Resource limits for this query exceeded",
		);
	});
});
