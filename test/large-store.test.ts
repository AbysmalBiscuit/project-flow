import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	goodPoll,
	issuesResponse,
	listedRead,
	otherRepo,
	page,
	readOverview,
	recordedOrEmpty,
	repo,
	ticket,
} from "./live-support.ts";
import {
	githubPullNode,
	recordedDiscovery,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const ticketCount = 600;
const pullCount = 150;
const readLimitMs = 200;

const filler = "The change keeps the board in step with the tracker. ".repeat(
	40,
);

function tickets(updatedAt: string) {
	return Array.from({ length: ticketCount }, (_, index) => {
		const number = index + 1;
		return {
			...ticket(number, updatedAt),
			body: `Blocked by #${number + 1}\nBlocks: #${Math.max(1, number - 1)}\n\n${filler}`,
		};
	});
}

const pulls = Array.from({ length: pullCount }, (_, index) =>
	githubPullNode({
		number: ticketCount + index + 1,
		body: `Closes #${index * 4 + 1}\n\n${filler}`,
		head: { ref: `feature/work-${index}` },
	}),
);

async function timedRead(base: string, path: string) {
	const started = performance.now();
	const response = await fetch(new URL(path, base));
	await response.arrayBuffer();
	return { path, status: response.status, ms: performance.now() - started };
}

test("a large store answers each read within the limit while a poll publishes", async () => {
	const readsOf = new Map<string, number>();
	let releaseRepo: () => void = () => {};
	const repoHeld = new Promise<void>((resolve) => {
		releaseRepo = resolve;
	});
	let releaseOther: () => void = () => {};
	const otherHeld = new Promise<void>((resolve) => {
		releaseOther = resolve;
	});
	let markRepoWaiting: () => void = () => {};
	const repoWaiting = new Promise<void>((resolve) => {
		markRepoWaiting = resolve;
	});
	const fetchImpl: Fetch = async (input, init) => {
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const listed = listedRead(input, init)?.repo;
		if (listed === repo || listed === otherRepo) {
			const reads = (readsOf.get(listed) ?? 0) + 1;
			readsOf.set(listed, reads);
			if (listed === otherRepo) {
				if (reads > 1) {
					await otherHeld;
				}
				return issuesResponse(input, init, [], otherRepo) ?? page([]);
			}
			if (reads > 1) {
				markRepoWaiting();
				await repoHeld;
			}
			const updatedAt = reads > 1 ? goodPoll : "2026-04-01T00:00:00Z";
			return (
				issuesResponse(input, init, tickets(updatedAt), repo, pulls) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo },
				{ tracker: "github", repo: otherRepo },
			],
			pollIntervalSeconds: 3600,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			void (async () => {
				const seeded = await settledOverview(base, readOverview);
				expect(seeded.projects.map((project) => project.name)).toEqual([
					repo,
					otherRepo,
				]);
				const refresh = await fetch(new URL("/api/refresh", base), {
					method: "POST",
				});
				expect(refresh.status).toBe(204);
				await repoWaiting;
				releaseRepo();
				const reads = await Promise.all(
					[
						"/api/overview",
						`/api/projects/${encodeURIComponent(repo)}`,
						"/api/settings",
					].map((read) => timedRead(base, read)),
				);
				expect(reads.filter((read) => read.status !== 200)).toEqual([]);
				expect(reads.filter((read) => read.ms >= readLimitMs)).toEqual([]);
				expect((await readOverview(base)).polling).toBe(true);
				releaseOther();
				resolve();
			})().catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo(
				{
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: fetchImpl,
					readGhToken: async () => null,
					databasePath,
					now: () => new Date(goodPoll),
					stdout: (line) => startChecks(line),
					waitForStop: checks,
				},
				{ first: true },
			),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		releaseRepo();
		releaseOther();
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
});
