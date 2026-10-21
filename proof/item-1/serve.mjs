import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/main.ts";
import { proofStops } from "../lifetime.ts";

const board = "acme/board";
const launch = "acme/launch";
const quiet = "acme/quiet";
const asked = "acme/asked";
const ask = "<!-- workcell:ask 11-1 -->";

function issue(number, title, state, reason, body) {
	return {
		number,
		title,
		state,
		state_reason: reason,
		body,
		updated_at: "2026-10-18T12:00:00Z",
	};
}

function issuesFor(repo) {
	if (repo === board) {
		return [
			issue(9, "Ship the board", "open", null, ""),
			issue(4, "Closed board ticket", "closed", "completed", ""),
		];
	}
	if (repo === launch) {
		return [
			issue(1, "Done launch", "closed", "completed", ""),
			issue(2, "Done launch two", "closed", "completed", ""),
			issue(3, "Wait on the board", "open", null, "Blocked by: acme/board#9"),
			issue(8, "Wait on billing", "open", null, "Blocked by: acme/quiet#2"),
		];
	}
	if (repo === quiet) {
		return [issue(2, "Hold billing", "open", null, "")];
	}
	if (repo === asked) {
		return [
			issue(1, "Done ask", "closed", "completed", ""),
			{ ...issue(5, "Ask one", "open", null, ""), comments: 1 },
			{ ...issue(6, "Ask two", "open", null, ""), comments: 1 },
		];
	}
	return [];
}

function recorded(input, init) {
	const url = typeof input === "string" ? input : input.url;
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return Response.json([]);
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("OrgProjects")
	) {
		return Response.json({
			data: {
				organization: {
					projectsV2: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ViewerProjects")
	) {
		return Response.json({
			data: {
				viewer: {
					login: "lev",
					projectsV2: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					organizations: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	const boardList = `https://api.github.com/repos/${board}/issues`;
	const launchList = `https://api.github.com/repos/${launch}/issues`;
	const quietList = `https://api.github.com/repos/${quiet}/issues`;
	const askedList = `https://api.github.com/repos/${asked}/issues`;
	if (url.startsWith(boardList) && url.includes("state=all")) {
		return Response.json(issuesFor(board));
	}
	if (url.startsWith(launchList) && url.includes("state=all")) {
		return Response.json(issuesFor(launch));
	}
	if (url.startsWith(quietList) && url.includes("state=all")) {
		return Response.json(issuesFor(quiet));
	}
	if (url.startsWith(askedList) && url.includes("state=all")) {
		return Response.json(issuesFor(asked));
	}
	if (
		url.includes(`/repos/${asked}/issues/5/comments`) ||
		url.includes(`/repos/${asked}/issues/6/comments`)
	) {
		return Response.json([{ body: `This waits on Lev.\n\n${ask}` }]);
	}
	if (url.includes("/pulls?") || url.includes("/branches?")) {
		return Response.json([]);
	}

	if (url === "https://api.linear.app/graphql") {
		return Response.json({
			data: {
				viewer: { id: "lev" },
				projects: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	return new Response(`not recorded ${url}`, { status: 404 });
}

const dir = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		pinned: [
			{ tracker: "github", repo: board },
			{ tracker: "github", repo: launch },
			{ tracker: "github", repo: quiet },
			{ tracker: "github", repo: asked },
		],
	})}\n`,
);
const databasePath = join(dir, "project-flow.sqlite");

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "4173"],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: recorded,
		readGhToken: async () => null,
		databasePath,
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	},
);
process.exit(result.exitCode);
