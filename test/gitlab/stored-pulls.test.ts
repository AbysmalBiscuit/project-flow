import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectReport } from "../../src/domain.ts";
import { run } from "../../src/main.ts";
import recordedMerged from "../fixtures/gitlab/merge-request-merged.json";
import { tempConfig, testIo } from "../support/app.ts";
import { settledOverview } from "../support/reads.ts";
import {
	gitlabEnv,
	gitlabFake,
	gitlabPin,
	gitlabPullUrl,
	gitlabRepo,
} from "./_support.ts";

const merged = {
	...recordedMerged,
	web_url: gitlabPullUrl(recordedMerged.iid),
	description: "Closes #2",
};

/** Rewrites each stored PR in the form that a store held before GitLab PR keys took the `!` mark. */
function unmarkStoredPulls(databasePath: string): void {
	const db = new Database(databasePath);
	const rows = db
		.query("select snapshot_key, payload from snapshots")
		.all() as { snapshot_key: string; payload: string }[];
	for (const row of rows) {
		const payload = JSON.parse(row.payload) as {
			pulls: Record<string, unknown>[];
		};
		for (const pull of payload.pulls) {
			delete pull.mark;
		}
		db.run("update snapshots set payload = ? where snapshot_key = ?", [
			JSON.stringify(payload),
			row.snapshot_key,
		]);
	}
	db.close();
}

async function polledReport(base: string): Promise<ProjectReport> {
	const overview = async (url: string) =>
		(await (await fetch(new URL("/api/overview", url))).json()) as {
			polling?: true;
		};
	await settledOverview(base, overview);
	await fetch(new URL("/api/refresh", base), { method: "POST" });
	await settledOverview(base, overview);
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(gitlabRepo)}?view=all`, base),
	);
	return (await response.json()) as ProjectReport;
}

/** The PR keys that a report shows, on ticket cards and on unlinked PR cards. */
function shownPulls(report: ProjectReport): string[] {
	return report.tickets.flatMap((ticket) =>
		ticket.pull === undefined ? [] : [ticket.pull],
	);
}

test("a stored GitLab PR with no mark shows once, with its ! key, after a restart", async () => {
	const root = await mkdtemp(join(tmpdir(), "project-flow-gitlab-store-"));
	const databasePath = join(root, "project-flow.sqlite");
	const { path, cleanup } = await tempConfig(
		JSON.stringify({ tracked: [gitlabPin] }),
	);
	const reports: ProjectReport[] = [];
	const start = async () => {
		let startCheck: (base: string) => void = () => {};
		const checked = new Promise<void>((resolve, reject) => {
			startCheck = (base) => {
				polledReport(base).then((report) => {
					reports.push(report);
					resolve();
				}, reject);
			};
		});
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITLAB_TOKEN: gitlabEnv.GITLAB_TOKEN },
				fetch: gitlabFake({ merged: [merged] }),
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => startCheck(line),
				waitForStop: checked,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	};
	try {
		await start();
		unmarkStoredPulls(databasePath);
		await start();
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
	const [first, restarted] = reports;
	expect(first).toBeDefined();
	expect(restarted).toBeDefined();
	if (first === undefined || restarted === undefined) {
		return;
	}
	expect(shownPulls(restarted).sort()).toEqual(shownPulls(first).sort());
	expect(shownPulls(restarted)).toContain(`${gitlabRepo}!${merged.iid}`);
	expect(shownPulls(restarted).filter((key) => key.includes("#"))).toEqual([]);
});
