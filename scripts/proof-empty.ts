import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-176-proof-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({ pinned: [], checkoutRoots: [], theme: "light" })}\n`,
);

const stop = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});

const fetchImpl: Fetch = async (input) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	if (
		url.startsWith("http://127.0.0.1") ||
		url.startsWith("http://localhost")
	) {
		return fetch(input);
	}
	return new Promise(() => {});
};

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "4176"],
	{
		env: {
			...process.env,
			XDG_DATA_HOME: join(root, "data"),
			GITHUB_TOKEN: "recorded-token",
		},
		fetch: fetchImpl,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(root, "data", "project-flow.sqlite"),
		stdout: (line) => {
			console.log(line);
		},
		stderr: (line) => {
			console.error(line);
		},
		waitForStop: stop,
	},
);

process.exit(result.exitCode);
