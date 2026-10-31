import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { urlOf } from "../test/support/fetch.ts";
import { recordedDiscovery } from "../test/support/github.ts";
import { repoReadFromLists } from "../test/support/repo-read.ts";
import { serveProof } from "./lifetime.ts";

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

/** Serves the GitHub repo reads of these issues and PRs and empty answers for the rest. */
export function recordedIssues(
	issuesByRepo: Record<string, Record<string, unknown>[]>,
	pullsByRepo: Record<string, Record<string, unknown>[]> = {},
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const listed =
			emptyLinear(url) ??
			repoReadFromLists(input, init, issuesByRepo, pullsByRepo);
		if (listed !== null) {
			return listed;
		}
		if (emptyLists(url) || url.includes("/dependencies/")) {
			return Response.json([]);
		}
		if (url === "https://api.github.com/graphql") {
			return Response.json({ data: {} });
		}
		return unrecorded(input);
	};
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
	databasePath?: string;
	fetch: Fetch;
	now?: () => Date;
	/** Replaces the recorded credentials, to show a missing one. */
	credentials?: Record<string, string>;
}): Promise<never> {
	const dir = options.dir ?? (await mkdtemp(join("/var/tmp", options.prefix)));
	const configPath = options.configPath ?? join(dir, "config.json");
	if (options.config !== undefined) {
		await writeFile(configPath, `${JSON.stringify(options.config)}\n`);
	} else if (options.configPath === undefined) {
		throw new Error("recorded proof needs a configuration");
	}
	return serveProof(
		["--config", configPath, "--host", "127.0.0.1", "--port", options.port],
		{
			env: {
				...(options.credentials ?? {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				}),
				XDG_DATA_HOME: dir,
			},
			fetch: options.fetch,
			readGhToken: async () => null,
			listTodos: async () => "",
			listCheckouts: async () => [],
			databasePath: options.databasePath ?? join(dir, "project-flow.sqlite"),
			now: options.now ?? (() => new Date("2026-10-18T12:00:00.000Z")),
			stdout: (line) => console.log(line),
			stderr: (line) => console.error(line),
		},
	);
}
