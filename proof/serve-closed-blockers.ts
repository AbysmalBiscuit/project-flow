import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedClosedBlockers from "../test/fixtures/github-closed-blockers.json";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedViewer } from "../test/support/github.ts";
import { repoReadIssues } from "../test/support/repo-read.ts";
import { proofStops } from "./lifetime.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-closed-blockers-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const repo = "acme/widget";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [{ tracker: "github", repo }],
		pollIntervalSeconds: 3600,
	}),
);

const nodes = structuredClone(recordedClosedBlockers.issues).map((node) => {
	if (node.number !== 216 && node.number !== 245 && node.number !== 246) {
		return node;
	}
	if (node.number === 216) {
		return {
			...node,
			state: "CLOSED",
			stateReason: "COMPLETED",
			closedAt: "2026-08-18T13:00:00Z",
			updatedAt: "2026-08-18T13:00:00Z",
		};
	}
	return {
		...node,
		updatedAt: "2026-08-18T13:00:00Z",
		blockedBy: {
			...node.blockedBy,
			nodes: node.blockedBy.nodes.map((blocker) =>
				blocker.number === 216 ? { ...blocker, state: "CLOSED" } : blocker,
			),
		},
	};
});

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		return new Response(
			JSON.stringify(repoReadIssues("acme", "widget", nodes)),
			{
				status: 200,
				headers: { "content-type": "application/json" },
			},
		);
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query BlockerStates")
	) {
		const asked = [...body.matchAll(/issue\(number: (\d+)\)/g)].map((match) =>
			Number(match[1]),
		);
		const byNumber = new Map(
			nodes.map((node) => [node.number, node.blockedBy]),
		);
		const repository: Record<string, unknown> = {};
		for (const [index, number] of asked.entries()) {
			const blockedBy = byNumber.get(number);
			if (blockedBy === undefined) {
				continue;
			}
			repository[`i${index}`] = { blockedBy };
		}
		return new Response(JSON.stringify({ data: { repository } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.includes(`/repos/${repo}/issues?`)) {
		return Response.json([]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments")
	) {
		return Response.json([]);
	}
	return new Response("unrecorded", { status: 404 });
};

const port = Number(process.argv[2] ?? "4173");
const stops = proofStops();
await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", String(port)],
	{
		env: { GITHUB_TOKEN: "recorded-token" },
		fetch: answerRecordedRepoRead(recorded),
		readGhToken: async () => null,
		databasePath: join(root, "store.sqlite"),
		stdout: (line) => {
			console.log(line);
		},
		waitForStop: stops,
	},
);
