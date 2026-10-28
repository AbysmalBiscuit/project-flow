import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Configuration } from "../src/configuration.ts";
import type { Overview } from "../src/domain.ts";
import type {
	FactoryTokenFileReport,
	FactoryTokenReport,
} from "../src/factory-tokens.ts";
import { refreshSettled } from "./events.ts";
import {
	acmeBearer,
	acmeToken,
	forOwner,
	githubCalls,
	hostsText,
	type Recorded,
	recordedIssue,
	recordingFetch,
	serve,
	userBearer,
} from "./factory-token/_support.ts";
import { settledOverview } from "./support/reads.ts";

const otherToken = "ghs_other_installation";

async function factoryTokenReports(
	base: string,
): Promise<FactoryTokenFileReport[]> {
	const settings = (await (
		await fetch(new URL("/api/settings", base))
	).json()) as { factoryTokenReports: FactoryTokenReport[] };
	return settings.factoryTokenReports.filter(
		(report) => report.cause !== "mint failed",
	);
}

describe("factory GitHub tokens", () => {
	test("reads and polls send the owner token and a reply sends the user token", async () => {
		const home = await mkdtemp(join(tmpdir(), "project-flow-factory-"));
		const folder = join(home, "tokens");
		await mkdir(join(folder, "acme"), { recursive: true });
		await mkdir(join(folder, "other"), { recursive: true });
		await writeFile(
			join(folder, "acme", "hosts.yml"),
			hostsText(acmeToken, "2026-08-18T13:00:00.000Z"),
		);
		await writeFile(
			join(folder, "other", "hosts.yml"),
			hostsText(otherToken, "2026-08-18T13:00:00.000Z"),
		);
		const recorded: Recorded[] = [];
		const clock = { at: new Date("2026-08-18T12:00:00.000Z") };
		const recording = recordingFetch(
			recorded,
			{
				"acme/widget": [recordedIssue("acme/widget")],
				"other/tool": [recordedIssue("other/tool")],
			},
			(login) =>
				login === "acme"
					? {
							data: {
								organization: {
									projectsV2: {
										nodes: [],
										pageInfo: { hasNextPage: false, endCursor: null },
									},
								},
							},
						}
					: { data: {} },
		);
		let pollHeld: Promise<void> | null = null;
		let releasePoll = () => {};
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [
					{ tracker: "github", repo: "acme/widget" },
					{ tracker: "github", repo: "other/tool" },
				],
			},
			fetchImpl: async (input, init) => {
				await pollHeld;
				return recording(input, init);
			},
			now: () => clock.at,
			home,
		});
		try {
			const overview = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
			expect(overview.projects.map((project) => project.name).sort()).toEqual([
				"acme/widget",
				"other/tool",
			]);

			const reads = githubCalls(recorded);
			const acmeReads = forOwner(reads, "acme");
			const otherReads = forOwner(reads, "other");
			expect(acmeReads.length).toBeGreaterThan(0);
			expect(otherReads.length).toBeGreaterThan(0);
			expect(acmeReads.every((item) => item.authorization === acmeBearer)).toBe(
				true,
			);
			expect(
				otherReads.every(
					(item) => item.authorization === `Bearer ${otherToken}`,
				),
			).toBe(true);
			expect(
				reads
					.filter(
						(item) =>
							forOwner([item], "acme").length === 0 &&
							forOwner([item], "other").length === 0,
					)
					.every((item) => item.authorization === userBearer),
			).toBe(true);
			const orgDiscovery = reads.filter((item) =>
				item.body.includes("OrgProjects"),
			);
			expect(orgDiscovery.length).toBeGreaterThan(0);
			expect(
				orgDiscovery.every((item) => item.authorization === acmeBearer),
			).toBe(true);

			recorded.length = 0;
			const reply = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#205",
					body: "Use the short name.",
				}),
			});
			expect(reply.status).toBe(201);
			const posted = githubCalls(recorded).filter(
				(item) => item.method === "POST",
			);
			const comment = posted.find((item) => item.url.endsWith("/comments"));
			expect(comment?.authorization).toBe(userBearer);
			expect(
				posted
					.filter((item) => item.url !== comment?.url)
					.every((item) => item.authorization === acmeBearer),
			).toBe(true);

			recorded.length = 0;
			pollHeld = new Promise((resolve) => {
				releasePoll = resolve;
			});
			const refreshed = await fetch(new URL("/api/refresh", app.base), {
				method: "POST",
			});
			expect(refreshed.status).toBe(204);
			// The refresh poll's tracker requests stay held until the first
			// overview answers, so the check must wait for the settled one.
			await settledOverview(app.base, async (base) => {
				const body = (await (
					await fetch(new URL("/api/overview", base))
				).json()) as Overview;
				releasePoll();
				return body;
			});
			const poll = forOwner(githubCalls(recorded), "acme").filter(
				(item) => item.method !== "POST" || item.url.includes("/graphql"),
			);
			expect(poll.length).toBeGreaterThan(0);
			expect(poll.every((item) => item.authorization === acmeBearer)).toBe(
				true,
			);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a missing, unreadable or expired token file uses the user token and the page stays clear", async () => {
		const home = await mkdtemp(join(tmpdir(), "project-flow-factory-"));
		const folder = join(home, "tokens");
		await mkdir(join(folder, "gone"), { recursive: true });
		await mkdir(join(folder, "locked"), { recursive: true });
		await mkdir(join(folder, "stale"), { recursive: true });
		await writeFile(
			join(folder, "locked", "hosts.yml"),
			hostsText("ghs_locked", "2026-08-18T13:00:00.000Z"),
		);
		await chmod(join(folder, "locked", "hosts.yml"), 0o000);
		await writeFile(
			join(folder, "stale", "hosts.yml"),
			hostsText("ghs_stale", "2026-08-18T11:00:00.000Z"),
		);
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [
					{ tracker: "github", repo: "gone/widget" },
					{ tracker: "github", repo: "locked/widget" },
					{ tracker: "github", repo: "stale/widget" },
				],
			},
			fetchImpl: recordingFetch(recorded, {
				"gone/widget": [recordedIssue("gone/widget")],
				"locked/widget": [recordedIssue("locked/widget")],
				"stale/widget": [recordedIssue("stale/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
		});
		try {
			const overview = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
			expect(overview.projects.every((project) => project.error === null)).toBe(
				true,
			);
			const reads = [
				...forOwner(githubCalls(recorded), "gone"),
				...forOwner(githubCalls(recorded), "locked"),
				...forOwner(githubCalls(recorded), "stale"),
			];
			expect(reads.length).toBeGreaterThan(0);
			expect(reads.every((item) => item.authorization === userBearer)).toBe(
				true,
			);
			expect(
				reads.some((item) => item.authorization === "Bearer ghs_stale"),
			).toBe(false);
			expect(
				(await factoryTokenReports(app.base)).sort((left, right) =>
					left.owner.localeCompare(right.owner),
				),
			).toEqual([
				{
					owner: "gone",
					cause: "missing",
					path: join(folder, "gone", "hosts.yml"),
				},
				{
					owner: "locked",
					cause: "unreadable",
					path: join(folder, "locked", "hosts.yml"),
				},
				{
					owner: "stale",
					cause: "expired",
					path: join(folder, "stale", "hosts.yml"),
				},
			]);
		} finally {
			await chmod(join(folder, "locked", "hosts.yml"), 0o600);
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("turning the option on with an empty token folder reports the missing token and polls on the user token", async () => {
		const home = await mkdtemp(join(tmpdir(), "project-flow-factory-"));
		const folder = join(home, "tokens");
		await mkdir(folder, { recursive: true });
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokenDir: folder,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
		});
		try {
			expect(await factoryTokenReports(app.base)).toEqual([]);
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...settings, factoryGithubTokens: true }),
			});
			expect(saved.status).toBe(200);
			recorded.length = 0;
			await refreshSettled(app.base);

			const reads = forOwner(githubCalls(recorded), "acme");
			expect(reads.length).toBeGreaterThan(0);
			expect(reads.every((item) => item.authorization === userBearer)).toBe(
				true,
			);
			expect(await factoryTokenReports(app.base)).toEqual([
				{
					owner: "acme",
					cause: "missing",
					path: join(folder, "acme", "hosts.yml"),
				},
			]);
			const overview = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});
});
