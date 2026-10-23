import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src/app.ts";
import type { PullRequest, Snapshot, Ticket } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { sqliteStore } from "../src/store.ts";

// Usage: bun proof/time-358.ts [projects] [tickets per project]
const projectCount = Number(process.argv[2] ?? "20");
const ticketCount = Number(process.argv[3] ?? "600");
const root = await mkdtemp(join(tmpdir(), "project-flow-358-"));
const repos = Array.from({ length: projectCount }, (_, i) => `acme/p${i}`);
const words = "the board shows each ticket and its pull request ".repeat(10);

function ticket(repo: string, n: number): Ticket {
	const other = repos[(n * 7) % repos.length] ?? repo;
	return {
		id: `${repo}#${n}`,
		tracker: "github",
		key: `${repo}#${n}`,
		title: `Ticket ${n} of ${repo}`,
		state: n % 3 === 0 ? "closed" : "open",
		stateReason: n % 3 === 0 ? "completed" : null,
		updatedAt: "2026-10-01T00:00:00Z",
		body: `${words}\nBlocked by #${n + 1} and ${other}#${n}.\nPart of #${Math.max(1, n - 5)}.`,
		blockedBy:
			n % 4 === 0
				? [{ tracker: "github", project: repo, key: `${repo}#${n + 1}` }]
				: [],
		comments: Array.from({ length: 4 }, (_, c) => ({
			body: `${words} fixes #${n + c}`,
			createdAt: "2026-10-01T00:00:00Z",
		})),
		milestone: null,
		parent: null,
		labels: n % 5 === 0 ? ["bug"] : [],
	};
}

function pull(repo: string, n: number): PullRequest {
	return {
		repo,
		number: 10_000 + n,
		url: `https://github.com/${repo}/pull/${10_000 + n}`,
		title: `Fix ${n}`,
		draft: false,
		branch: `${n}-fix`,
		body: `${words}\nCloses #${n}. Resolves ${repo}#${n + 1}.`,
		closingKeys: [`${repo}#${n}`],
		headSha: `sha${n}`,
		headCommittedAt: "2026-10-01T00:00:00Z",
		merged: n % 2 === 0,
		checks: [],
		comments: [],
		reviews: [],
		reactions: [],
	};
}

const rows: Snapshot[] = repos.map((repo) => ({
	key: repo,
	name: repo,
	tracker: "github",
	tickets: Array.from({ length: ticketCount }, (_, n) => ticket(repo, n + 1)),
	pulls: Array.from({ length: ticketCount / 3 }, (_, n) => pull(repo, n + 1)),
	branches: [],
	startedKeys: [],
}));
const databasePath = join(root, "project-flow.sqlite");
const seeded = sqliteStore(databasePath);
seeded.store.replaceTickets(rows);
for (const repo of repos) {
	seeded.store.recordGoodPoll(
		{ kind: "github-repo", tracker: "github", key: repo },
		new Date("2026-10-01T00:00:00Z"),
	);
}
seeded.close();
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		tracked: repos.map((repo) => ({ tracker: "github", repo })),
		pollIntervalSeconds: 3600,
	}),
);

// The poll never ends, so the store stays as seeded.
const silent: Fetch = (_input, init) =>
	new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () => reject(new Error("stopped")));
	});

const startedAt = performance.now();
const running = await start({
	configPath,
	token: "recorded-token",
	linearKey: null,
	fetch: silent,
	databasePath,
	hostname: "127.0.0.1",
	port: 0,
});
const startMs = performance.now() - startedAt;
const size = (await stat(databasePath)).size;
console.log(
	`store: ${projectCount} projects, ${ticketCount} tickets each, ${(size / 1_048_576).toFixed(1)} MB`,
);
// A stored project list makes start() compute every project view once.
console.log(`start ${startMs.toFixed(0)} ms`);

async function timed(path: string): Promise<void> {
	const began = performance.now();
	const response = await fetch(new URL(path, running.url));
	await response.arrayBuffer();
	const ms = performance.now() - began;
	console.log(`${response.status} ${path} ${ms.toFixed(0)} ms`);
}

await timed("/api/overview");
for (const repo of repos.slice(0, 3)) {
	const path = `/api/projects/${encodeURIComponent(repo)}`;
	await timed(path);
	await timed(path);
	await timed(`${path}?view=all`);
}
await timed("/api/overview");
await rm(root, { recursive: true, force: true });
// stop() waits for the poll, which never ends here.
process.exit(0);
