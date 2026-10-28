/**
 * Serves a configuration that tracks Acme/Widget with a saved expected-bot override, while discovery finds acme/widget.
 * The next port serves the expectedBots field of the configuration file, so a walk can read what a save wrote.
 * Usage: bun proof/serve-386.ts [PORT]
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";

import { urlOf } from "../test/support/fetch.ts";
import { recordedIssues, serveRecorded } from "./recorded.ts";

const port = process.argv[2]?.trim() || "4386";
const dir = await mkdtemp(join("/var/tmp", "project-flow-386-"));
const configPath = join(dir, "config.json");
const repos = recordedIssues({ "acme/widget": [] });

Bun.serve({
	hostname: "127.0.0.1",
	port: Number(port) + 1,
	fetch: async () => {
		const saved: { expectedBots?: unknown } = JSON.parse(
			await readFile(configPath, "utf8"),
		);
		return new Response(
			`<pre>expectedBots ${JSON.stringify(saved.expectedBots)}</pre>`,
			{ headers: { "content-type": "text/html" } },
		);
	},
});

await serveRecorded({
	prefix: "project-flow-386-",
	port,
	dir,
	config: {
		tracked: [{ tracker: "github", repo: "Acme/Widget" }],
		expectedBots: { "Acme/Widget": ["grok"] },
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		theme: "light",
	},
	fetch: async (input, init) =>
		urlOf(input).startsWith("https://api.github.com/user/repos")
			? Response.json([
					{
						full_name: "acme/widget",
						owner: { login: "lev" },
						permissions: { push: true },
						pushed_at: "2026-10-18T11:00:00.000Z",
					},
				])
			: repos(input, init),
});
