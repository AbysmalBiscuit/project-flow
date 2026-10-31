import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { run } from "../src/main.ts";
import {
	gitlabEnv,
	gitlabFake,
	linearProject,
	linearTicket,
	linearWithGitlab,
} from "../test/gitlab/_support.ts";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2] ?? "4780";
const dir = await mkdtemp(join("/var/tmp", "project-flow-780-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		pinned: [{ tracker: "linear", project: linearProject }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	})}\n`,
);

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", port],
	{
		env: { ...gitlabEnv, XDG_DATA_HOME: dir },
		fetch: linearWithGitlab([linearTicket(1, [12])], gitlabFake()),
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	},
);
process.exit(result.exitCode);
