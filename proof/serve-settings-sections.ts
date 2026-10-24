import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2] ?? "47101";
const root = await mkdtemp(join("/var/tmp", "project-flow-settings-sections-"));
const config = join(root, "config.json");
await writeFile(
	config,
	`${JSON.stringify(
		{
			theme: process.env.SETTINGS_THEME === "dark" ? "dark" : "light",
			pinned: [],
			hidden: [],
			activityWindowDays: 30,
			pollIntervalSeconds: 60,
			checkoutRoots: [],
			needsYouLabels: ["needs-human", "needs-engineer"],
			viewerLogins: ["AbysmalBiscuit"],
			notificationTriggers: {
				needsYou: true,
				comment: true,
				blockerCleared: true,
			},
			projectViews: {
				"*": {
					openView: "board",
					graphDirection: "left-to-right",
					maxAgeDays: { Done: 2 },
					needsYouOnly: false,
					blockedOnly: false,
				},
			},
		},
		null,
		"\t",
	)}\n`,
);

const recorded: Fetch = async (input) => {
	const url = String(input instanceof Request ? input.url : input);
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url === "https://api.github.com/graphql") {
		return new Response(
			JSON.stringify({
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
			}),
			{ status: 200 },
		);
	}
	if (url === "https://api.linear.app/graphql") {
		return new Response(
			JSON.stringify({
				data: {
					viewer: { id: "lev" },
					projects: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			}),
			{ status: 200 },
		);
	}
	return new Response("[]", {
		status: 200,
		headers: { "content-type": "application/json" },
	});
};

try {
	await run(["--config", config, "--host", "127.0.0.1", "--port", port], {
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: root,
		},
		fetch: answerRecordedRepoRead(recorded),
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
