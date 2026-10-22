import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, repoReadIssues, urlOf } from "../test/support.ts";
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

function issue(
	number: number,
	title: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: "2026-08-18T12:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
		body: "",
	};
}

const pageInfo = { hasNextPage: false, endCursor: null };

function relation(
	number: number,
	title: string,
	state: "OPEN" | "CLOSED",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		repository: { nameWithOwner: repo },
	};
}

function node(
	number: number,
	title: string,
	state: "OPEN" | "CLOSED",
	blockedBy: Record<string, unknown>[] = [],
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		stateReason: state === "CLOSED" ? "COMPLETED" : null,
		updatedAt: "2026-08-18T12:00:00.000Z",
		body: "",
		blockedBy: { nodes: blockedBy, pageInfo },
		blocking: { nodes: [], pageInfo },
	};
}

const nodes = [
	node(245, "Draw the board", "OPEN", [
		relation(216, "Closed native blocker", "CLOSED"),
	]),
	node(216, "Closed native blocker", "CLOSED"),
	node(246, "Keep the open blocker", "OPEN", [
		relation(216, "Closed native blocker", "CLOSED"),
		relation(188, "Open native blocker", "OPEN"),
	]),
	node(188, "Open native blocker", "OPEN"),
];

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
		const repository: Record<string, unknown> = {};
		for (const [index, item] of nodes.entries()) {
			if (item.state !== "OPEN" || !Array.isArray(item.blockedBy)) {
				continue;
			}
			repository[`i${index}`] = { blockedBy: item.blockedBy };
		}
		return new Response(JSON.stringify({ data: { repository } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.includes(`/repos/${repo}/issues?`)) {
		return Response.json([
			issue(245, "Draw the board"),
			issue(216, "Closed native blocker", "closed"),
			issue(246, "Keep the open blocker"),
			issue(188, "Open native blocker"),
		]);
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
		fetch: recorded,
		readGhToken: async () => null,
		databasePath: join(root, "store.sqlite"),
		stdout: (line) => {
			console.log(line);
		},
		waitForStop: stops,
	},
);
