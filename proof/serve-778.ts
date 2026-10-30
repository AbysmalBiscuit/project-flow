import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { recordedViewer } from "../test/support/github.ts";
import { proofStops } from "./lifetime.ts";

const root = await mkdtemp(join(tmpdir(), "project-flow-declared-hosts-"));
const configPath = join(root, "config.json");
const host = "git.acme.dev";
await writeFile(
	configPath,
	JSON.stringify({
		checkoutRoots: [],
		hosts: [{ host, forge: "github", tokenEnv: "ACME_FORGE_TOKEN" }],
		tracked: [
			{ tracker: "github", repo: "acme/widget" },
			{ tracker: "github", repo: "acme/widget", host },
		],
		expectedBots: {
			"acme/widget": ["codex"],
			[`${host}/acme/widget`]: ["grok"],
		},
		pmBot: { "acme/widget": false },
	}),
);

const recorded: Fetch = async (input, init) =>
	recordedViewer(input, init) ?? new Response("not recorded", { status: 404 });

const running = await start({
	configPath,
	credentials: { github: "recorded-token", linear: null },
	env: {},
	fetch: answerRecordedRepoRead(recorded),
	databasePath: join(root, "project-flow.sqlite"),
	hostname: "127.0.0.1",
	port: 4178,
});
await proofStops();
await running.stop();
