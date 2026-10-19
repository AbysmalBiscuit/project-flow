import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/main.ts";

const port = process.argv[2] ?? "4175";
const root = await mkdtemp(join("/var/tmp", "project-flow-settings-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	`${JSON.stringify(
		{
			pinned: [{ tracker: "github", repo: "acme/widget" }],
			hidden: [{ tracker: "linear", project: "quiet-board" }],
			activityWindowDays: 14,
			pollIntervalSeconds: 90,
			checkoutRoots: [],
			expectedBots: { "acme/widget": ["grok", "codex"] },
			noSenior: { "acme/widget": true },
			needsYouLabels: ["needs-human", "needs-engineer"],
			notificationTriggers: {
				needsYou: true,
				comment: false,
				blockerCleared: true,
			},
		},
		null,
		"\t",
	)}\n`,
);

await run(["--config", config, "--host", "127.0.0.1", "--port", port], {
	env: {},
	fetch: async () => new Response("not recorded", { status: 404 }),
	readGhToken: async () => null,
	listTodos: async () => "",
	listCheckouts: async () => [],
	databasePath: join(root, "project-flow.sqlite"),
	now: () => new Date("2026-08-18T12:00:00.000Z"),
	stdout: (line) => console.log(line),
	stderr: (line) => console.error(line),
	waitForStop: new Promise(() => {}),
});
