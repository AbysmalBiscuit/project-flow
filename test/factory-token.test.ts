import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Configuration } from "../src/configuration.ts";
import type { Overview } from "../src/domain.ts";
import {
	acmeBearer,
	acmeToken,
	forOwner,
	githubCalls,
	hostsText,
	issue,
	otherToken,
	type Recorded,
	recordingFetch,
	serve,
	userBearer,
} from "./factory-token-support.ts";

describe("factory GitHub tokens", () => {
	test("reads and polls send the owner token and a reply sends the user token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
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
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [
					{ tracker: "github", repo: "acme/widget" },
					{ tracker: "github", repo: "other/tool" },
				],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [issue(7)],
				"other/tool": [issue(3, "other/tool")],
			}),
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

			recorded.length = 0;
			const reply = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "acme/widget",
					key: "acme/widget#7",
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
			const refreshed = await fetch(new URL("/api/refresh", app.base), {
				method: "POST",
			});
			expect(refreshed.status).toBe(204);
			await fetch(new URL("/api/overview", app.base));
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
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
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
				"gone/widget": [issue(1, "gone/widget")],
				"locked/widget": [issue(2, "locked/widget")],
				"stale/widget": [issue(3, "stale/widget")],
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
		} finally {
			await chmod(join(folder, "locked", "hosts.yml"), 0o600);
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a token that expires while the app runs is read again before the next call", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		const hosts = join(folder, "acme", "hosts.yml");
		await mkdir(join(folder, "acme"), { recursive: true });
		await writeFile(hosts, hostsText(acmeToken, "2026-08-18T12:30:00.000Z"));
		const recorded: Recorded[] = [];
		const clock = { at: new Date("2026-08-18T12:00:00.000Z") };
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [issue(7)],
			}),
			now: () => clock.at,
			home,
		});
		try {
			const first = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(first.error).toBeNull();
			const before = forOwner(githubCalls(recorded), "acme");
			expect(before.length).toBeGreaterThan(0);
			expect(before.every((item) => item.authorization === acmeBearer)).toBe(
				true,
			);

			clock.at = new Date("2026-08-18T12:31:00.000Z");
			await writeFile(
				hosts,
				hostsText("ghs_acme_renewed", "2026-08-18T13:30:00.000Z"),
			);
			recorded.length = 0;
			const refreshed = await fetch(new URL("/api/refresh", app.base), {
				method: "POST",
			});
			expect(refreshed.status).toBe(204);
			const second = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(second.error).toBeNull();
			const after = forOwner(githubCalls(recorded), "acme");
			expect(after.length).toBeGreaterThan(0);
			expect(
				after.every((item) => item.authorization === "Bearer ghs_acme_renewed"),
			).toBe(true);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("the option is off by default and a blank folder uses the user token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokenDir: "   ",
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [issue(7)],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
		});
		try {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Configuration;
			expect(settings.factoryGithubTokens).toBe(false);
			expect(settings.factoryGithubTokenDir).toBe(
				join(homedir(), ".config", "factory-gh"),
			);
			const overview = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
			const reads = githubCalls(recorded);
			expect(reads.length).toBeGreaterThan(0);
			expect(reads.every((item) => item.authorization === userBearer)).toBe(
				true,
			);

			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...settings,
					factoryGithubTokens: true,
					factoryGithubTokenDir: join(home, "custom-tokens"),
				}),
			});
			expect(saved.status).toBe(200);
			const written = (await saved.json()) as Configuration;
			expect(written.factoryGithubTokens).toBe(true);
			expect(written.factoryGithubTokenDir).toBe(join(home, "custom-tokens"));
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a blank reply, a hosts file of spaces and a broken hosts file stay on the user token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		await mkdir(join(folder, "blank"), { recursive: true });
		await mkdir(join(folder, "spaced"), { recursive: true });
		await mkdir(join(folder, "broken"), { recursive: true });
		await writeFile(
			join(folder, "spaced", "hosts.yml"),
			"github.com:\n    oauth_token:    \n    expires_at: 2026-08-18T13:00:00.000Z\n",
		);
		await writeFile(join(folder, "broken", "hosts.yml"), "not a hosts file\n");
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [
					{ tracker: "github", repo: "blank/widget" },
					{ tracker: "github", repo: "spaced/widget" },
					{ tracker: "github", repo: "broken/widget" },
				],
			},
			fetchImpl: recordingFetch(recorded, {
				"blank/widget": [issue(1, "blank/widget")],
				"spaced/widget": [issue(2, "spaced/widget")],
				"broken/widget": [issue(3, "broken/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
		});
		try {
			const overview = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(overview.error).toBeNull();
			const reads = [
				...forOwner(githubCalls(recorded), "blank"),
				...forOwner(githubCalls(recorded), "spaced"),
				...forOwner(githubCalls(recorded), "broken"),
			];
			expect(reads.length).toBeGreaterThan(0);
			expect(reads.every((item) => item.authorization === userBearer)).toBe(
				true,
			);

			recorded.length = 0;
			const reply = await fetch(new URL("/api/replies", app.base), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker: "github",
					project: "blank/widget",
					key: "blank/widget#1",
					body: "   ",
				}),
			});
			expect(reply.status).toBe(400);
			expect(githubCalls(recorded).some((item) => item.method === "POST")).toBe(
				false,
			);

			const blankDir = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ factoryGithubTokenDir: "" }),
			});
			expect(blankDir.status).toBe(200);
			const stored = (await blankDir.json()) as Configuration;
			expect(stored.factoryGithubTokenDir).toBe(
				join(homedir(), ".config", "factory-gh"),
			);
			const failed = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ factoryGithubTokens: "   " }),
			});
			expect(failed.status).toBe(400);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});
});
