import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PullRequest, Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { sqliteStore } from "../../src/store.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadResponse } from "../support/repo-read.ts";

export const valid = JSON.stringify({
	pinned: [{ tracker: "github", repo: "acme/widget" }],
});

export function recordedFetch(userStatus: number): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ message: "recorded" }), {
				status: userStatus,
			});
		}
		if (
			url.includes("/issues?") ||
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/check-runs") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return new Response(
				url.includes("/check-runs") ? '{"check_runs":[]}' : "[]",
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}
		if (url === "https://api.github.com/graphql") {
			const read = repoReadResponse(input, init);
			if (read !== null) {
				return read;
			}
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				}),
				{ status: 200 },
			);
		}
		if (url === "https://api.linear.app/graphql") {
			return new Response(JSON.stringify({ data: { viewer: { id: "lev" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return unrecorded(input);
	};
}

export const host = "git.acme.dev";
export const tokenEnv = "ACME_FORGE_TOKEN";
export const hosts = [{ host, forge: "github", tokenEnv }];
export const widget = { tracker: "github" as const, repo: "acme/widget" };
export const hostedWidget = { ...widget, host };

/** A PR of `acme/widget` on the declared host, as a store row holds it. */
export function storedPull(
	number: number,
	extra: Partial<PullRequest>,
): PullRequest {
	return {
		repo: "acme/widget",
		number,
		url: `https://${host}/acme/widget/pull/${number}`,
		title: `Change ${number}`,
		draft: false,
		branch: `change-${number}`,
		body: "",
		closingKeys: [],
		headSha: "head",
		headCommittedAt: null,
		merged: false,
		checks: [],
		comments: [],
		reviews: [],
		reactions: [],
		...extra,
	};
}

export function recordingFetch(
	sent: { url: string; authorization: string | null }[],
): Fetch {
	const recorded = recordedFetch(200);
	return (input, init) => {
		sent.push({
			url: urlOf(input),
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return recorded(input, init);
	};
}

/** Starts the app, and runs the checks against it. */
export async function withStarted(
	configuration: unknown,
	checks: (base: string) => Promise<void>,
	fetchImpl: Fetch = recordedFetch(200),
	databasePath = ":memory:",
): Promise<void> {
	const { path, cleanup } = await tempConfig(JSON.stringify(configuration));
	let release: () => void = () => {};
	let finished: Promise<void> = Promise.resolve();
	const asked = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => {
					finished = checks(line);
					release();
				},
				waitForStop: asked.then(() => finished),
			}),
		);
		await finished;
	} finally {
		await cleanup();
	}
}

/** Runs the checks on an app whose store holds one row before it starts. */
export async function withStoredRow(
	row: Snapshot,
	configuration: Record<string, unknown>,
	checks: (base: string) => Promise<void>,
	fetchImpl?: Fetch,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
	const databasePath = join(root, "project-flow.sqlite");
	const seeded = sqliteStore(databasePath);
	seeded.store.mergeTickets([row]);
	seeded.close();
	try {
		await withStarted(configuration, checks, fetchImpl, databasePath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
