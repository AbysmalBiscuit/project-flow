import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PullRequest } from "../../src/domain.ts";
import { sqliteStore } from "../../src/store.ts";
import { host, hosts, storedPull, withStarted } from "./_support.ts";

const hostedKey = `${host}/acme/widget`;
const linearPin = { tracker: "linear", project: "PLAT" };

type BotRow = {
	key: string;
	repos: string[];
	expectedBots: string[];
	repoBots: Record<string, string[]>;
};

/** Runs the checks on an app whose store holds a Linear project that links PRs on the declared host. */
async function withLinkedPulls(
	pulls: PullRequest[],
	configuration: Record<string, unknown>,
	checks: (base: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
	const databasePath = join(root, "project-flow.sqlite");
	const seeded = sqliteStore(databasePath);
	seeded.store.mergeTickets([
		{
			key: "PLAT",
			name: "Platform",
			tracker: "linear",
			branches: [],
			startedKeys: [],
			tickets: [],
			pulls,
		},
	]);
	seeded.close();
	try {
		await withStarted(
			{ hosts, tracked: [linearPin], ...configuration },
			checks,
			undefined,
			databasePath,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function platformRow(response: Response): Promise<BotRow | undefined> {
	const { projects } = (await response.json()) as { projects: BotRow[] };
	return projects.find((row) => row.key === "PLAT");
}

async function saveBots(
	base: string,
	expectedBots: Record<string, string[]>,
): Promise<Response> {
	const url = new URL("/api/settings", base);
	const loaded = (await (await fetch(url)).json()) as Record<string, unknown>;
	return fetch(url, {
		method: "PUT",
		body: JSON.stringify({ ...loaded, expectedBots }),
	});
}

describe("the bot settings of a Linear project that links a PR on a declared host", () => {
	const reviewedByGrok = storedPull(1, {
		host,
		merged: true,
		checks: [
			{ name: "grok review", status: "completed", conclusion: "success" },
		],
	});

	test("key the repo by the host of the PR and infer its bots there", async () => {
		await withLinkedPulls([reviewedByGrok], {}, async (base) => {
			expect(
				await platformRow(await fetch(new URL("/api/settings", base))),
			).toMatchObject({
				repos: [hostedKey],
				expectedBots: ["grok"],
				repoBots: { [hostedKey]: ["grok"] },
			});
		});
	});

	test("a settings write saves under the host key and refuses the bare repo key", async () => {
		await withLinkedPulls([reviewedByGrok], {}, async (base) => {
			const bare = await saveBots(base, { "acme/widget": ["codex"] });
			expect(bare.status).toBe(400);
			expect(await bare.json()).toEqual({
				error: "invalid configuration: expectedBots.acme/widget",
			});

			const hosted = await saveBots(base, { [hostedKey]: ["codex"] });
			expect(hosted.status).toBe(200);
			expect(await platformRow(hosted)).toMatchObject({
				repos: [hostedKey],
				expectedBots: ["codex"],
				repoBots: { [hostedKey]: ["codex"] },
			});
		});
	});
});
