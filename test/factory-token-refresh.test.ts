import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Configuration } from "../src/configuration.ts";
import type { Overview } from "../src/domain.ts";
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
} from "./factory-token-support.ts";

describe("factory GitHub token refresh", () => {
	test("a token inside the renew window is read again and kept until it expires", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		const hosts = join(folder, "acme", "hosts.yml");
		await mkdir(join(folder, "acme"), { recursive: true });
		await writeFile(hosts, hostsText(acmeToken, "2026-08-18T12:02:00.000Z"));
		const recorded: Recorded[] = [];
		const clock = { at: new Date("2026-08-18T12:00:00.000Z") };
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
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

			await writeFile(
				hosts,
				hostsText("ghs_acme_near", "2026-08-18T12:03:00.000Z"),
			);
			recorded.length = 0;
			await refreshSettled(app.base);
			const second = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(second.error).toBeNull();
			const near = forOwner(githubCalls(recorded), "acme");
			expect(near.length).toBeGreaterThan(0);
			expect(
				near.every((item) => item.authorization === "Bearer ghs_acme_near"),
			).toBe(true);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a Settings save that changes the token folder drops the cached token for that owner", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const firstFolder = join(home, "tokens");
		const nextFolder = join(home, "moved-tokens");
		await mkdir(join(firstFolder, "acme"), { recursive: true });
		await mkdir(join(nextFolder, "acme"), { recursive: true });
		await writeFile(
			join(firstFolder, "acme", "hosts.yml"),
			hostsText(acmeToken, "2026-08-18T13:00:00.000Z"),
		);
		await writeFile(
			join(nextFolder, "acme", "hosts.yml"),
			hostsText("ghs_acme_moved", "2026-08-18T13:00:00.000Z"),
		);
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: firstFolder,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
		});
		try {
			const first = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(first.error).toBeNull();
			expect(
				forOwner(githubCalls(recorded), "acme").every(
					(item) => item.authorization === acmeBearer,
				),
			).toBe(true);

			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...settings,
					factoryGithubTokenDir: nextFolder,
				}),
			});
			expect(saved.status).toBe(200);
			recorded.length = 0;
			await refreshSettled(app.base);
			const second = (await (
				await fetch(new URL("/api/overview", app.base))
			).json()) as Overview;
			expect(second.error).toBeNull();
			const moved = forOwner(githubCalls(recorded), "acme");
			expect(moved.length).toBeGreaterThan(0);
			expect(
				moved.every((item) => item.authorization === "Bearer ghs_acme_moved"),
			).toBe(true);
		} finally {
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
				"acme/widget": [recordedIssue("acme/widget")],
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
			await refreshSettled(app.base);
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
				"acme/widget": [recordedIssue("acme/widget")],
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
				"blank/widget": [recordedIssue("blank/widget")],
				"spaced/widget": [recordedIssue("spaced/widget")],
				"broken/widget": [recordedIssue("broken/widget")],
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
					key: "blank/widget#205",
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
