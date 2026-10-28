import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../test/support/github.ts";

const port = process.argv.find((arg) => arg.startsWith("--port="))?.slice(7);
if (port === undefined || !/^\d+$/.test(port)) {
	console.error("usage: bun proof/serve-poll-progress.ts --port=N");
	process.exit(1);
}

const dataHome = await mkdtemp(join("/var/tmp", "project-flow-211-data-"));
const root = await mkdtemp(join("/var/tmp", "project-flow-211-proof-"));
const configPath = join(root, "config.json");
await Bun.write(
	configPath,
	`${JSON.stringify(
		{
			theme: "light",
			overview: {
				filter: "all",
				sort: "project",
				direction: "asc",
				view: "table",
			},
			tracked: [
				{ tracker: "github", repo: "acme/alpha" },
				{ tracker: "github", repo: "acme/beta" },
			],
			checkoutRoots: [],
			pollIntervalSeconds: 3600,
		},
		null,
		"\t",
	)}\n`,
);

const release: (() => void)[] = [];
let reads = 0;
const fetchImpl: Fetch = async (input, init) => {
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		reads += 1;
		if (reads === 1) {
			await new Promise<void>((resolve) => {
				release.push(resolve);
			});
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: "acme/held",
					autoMergeAllowed: false,
					refs: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					labels: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					issues: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					openPullRequests: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					mergedPullRequests: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	return unrecorded(input);
};

const stop = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", port],
	{
		env: {
			...process.env,
			XDG_DATA_HOME: dataHome,
			GITHUB_TOKEN: "recorded-token",
		},
		fetch: answerRecordedRepoRead(fetchImpl),
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dataHome, "project-flow.sqlite"),
		now: () => new Date("2026-10-21T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: stop,
	},
);

for (const end of release) {
	end();
}
await rm(root, { recursive: true, force: true });
await rm(dataHome, { recursive: true, force: true });
process.exit(result.exitCode);
