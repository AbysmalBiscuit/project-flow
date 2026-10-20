import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";

const board = "acme/board";
const gate = "acme/gate";

function issue(
	number: number,
	title: string,
	repo: string,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T12:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

const boardIssues = [
	issue(12, "Ship the widget", board),
	issue(3, "Hold the launch", board),
];
const gateIssues = [issue(9, "Open the gate", gate)];

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${board}/issues?`)) {
		return Response.json(boardIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${gate}/issues?`)) {
		return Response.json(gateIssues);
	}
	if (url === `https://api.github.com/repos/${board}/issues/12`) {
		return Response.json({
			title: "Ship the widget",
			html_url: `https://github.com/${board}/issues/12`,
		});
	}
	if (url.includes("/issues/12/comments")) {
		return Response.json([
			{
				id: 1,
				body: "Ready for the jump",
				created_at: "2026-10-18T12:00:00Z",
				user: { login: "lev" },
			},
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/dependencies/blocked_by")
	) {
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
};

const dir = await mkdtemp(join("/var/tmp", "project-flow-jump-"));
await writeFile(
	join(dir, "config.json"),
	`${JSON.stringify({
		pinned: [
			{ tracker: "github", repo: board },
			{ tracker: "github", repo: gate },
		],
		checkoutRoots: [],
	})}\n`,
);

const port = process.env.PORT ?? "4188";
const result = await run(
	["--config", join(dir, "config.json"), "--host", "127.0.0.1", "--port", port],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: dir,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: new Promise<void>((resolve) => {
			const stop = () => resolve();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}),
	},
);
process.exit(result.exitCode);
