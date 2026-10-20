import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { urlOf } from "../test/support.ts";

export function emptyLinear(url: string): Response | null {
	if (url !== "https://api.linear.app/graphql") {
		return null;
	}
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

export function emptyLists(url: string): boolean {
	return (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/dependencies/blocked_by")
	);
}

export function unrecorded(input: string | URL | Request): Response {
	return new Response(`not recorded ${urlOf(input)}`, { status: 404 });
}

export async function serveRecorded(options: {
	prefix: string;
	port: string;
	config?: unknown;
	dir?: string;
	configPath?: string;
	fetch: Fetch;
}): Promise<never> {
	const dir = options.dir ?? (await mkdtemp(join("/var/tmp", options.prefix)));
	const configPath = options.configPath ?? join(dir, "config.json");
	if (options.config !== undefined) {
		await writeFile(configPath, `${JSON.stringify(options.config)}\n`);
	} else if (options.configPath === undefined) {
		throw new Error("recorded proof needs a configuration");
	}
	const result = await run(
		["--config", configPath, "--host", "127.0.0.1", "--port", options.port],
		{
			env: {
				GITHUB_TOKEN: "recorded-token",
				LINEAR_API_KEY: "recorded-linear-key",
				XDG_DATA_HOME: dir,
			},
			fetch: options.fetch,
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
}
