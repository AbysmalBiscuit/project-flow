import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Configuration } from "../src/configuration.ts";
import type {
	FactoryTokenMint,
	FactoryTokenReport,
} from "../src/factory-tokens.ts";
import {
	forOwner,
	githubCalls,
	hostsText,
	type Recorded,
	recordedIssue,
	recordingFetch,
	serve,
	userBearer,
} from "./factory-token-support.ts";

const mintCommand = ["/opt/factory/bin/factory", "github-auth"];
const mintedToken = "ghs_acme_minted";

describe("factory GitHub token mint", () => {
	test("turning the option on runs the mint, and the poll reads carry the minted token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		const minted: { command: string[]; dir: string }[] = [];
		const mint: FactoryTokenMint = async (command, dir) => {
			minted.push({ command, dir });
			await mkdir(join(dir, "acme"), { recursive: true });
			await writeFile(
				join(dir, "acme", "hosts.yml"),
				hostsText(mintedToken, "2026-08-18T13:00:00.000Z"),
			);
			return { status: 0, stderr: "" };
		};
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokens: false,
				factoryGithubTokenDir: folder,
				factoryMintCommand: mintCommand,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
			mint,
		});
		try {
			expect(minted).toEqual([]);
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Configuration;
			recorded.length = 0;
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...settings, factoryGithubTokens: true }),
			});
			expect(saved.status).toBe(200);
			expect(minted).toEqual([{ command: mintCommand, dir: folder }]);
			const reads = forOwner(githubCalls(recorded), "acme");
			expect(reads.length).toBeGreaterThan(0);
			expect(
				reads.every((item) => item.authorization === `Bearer ${mintedToken}`),
			).toBe(true);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a mint that fails once runs again, and the poll reads carry the minted token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		let runs = 0;
		const mint: FactoryTokenMint = async (_command, dir) => {
			runs += 1;
			if (runs === 1) {
				return { status: 1, stderr: "<urlopen error timed out>\n" };
			}
			await mkdir(join(dir, "acme"), { recursive: true });
			await writeFile(
				join(dir, "acme", "hosts.yml"),
				hostsText(mintedToken, "2026-08-18T13:00:00.000Z"),
			);
			return { status: 0, stderr: "" };
		};
		const recorded: Recorded[] = [];
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				factoryMintCommand: mintCommand,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
			mint,
		});
		try {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as { factoryTokenReports: FactoryTokenReport[] };
			expect(settings.factoryTokenReports).toEqual([]);
			expect(runs).toBe(2);
			const reads = forOwner(githubCalls(recorded), "acme");
			expect(reads.length).toBeGreaterThan(0);
			expect(
				reads.every((item) => item.authorization === `Bearer ${mintedToken}`),
			).toBe(true);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a mint that fails three times shows its exit status and last stderr line in Settings, and the reads use the user token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
		const recorded: Recorded[] = [];
		let runs = 0;
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: folder,
				factoryMintCommand: mintCommand,
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			},
			fetchImpl: recordingFetch(recorded, {
				"acme/widget": [recordedIssue("acme/widget")],
			}),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
			mint: async () => {
				runs += 1;
				return {
					status: 1,
					stderr:
						"Traceback (most recent call last):\n<urlopen error timed out>\n\n",
				};
			},
		});
		try {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as { factoryTokenReports: FactoryTokenReport[] };
			expect(runs).toBe(3);
			expect(settings.factoryTokenReports).toEqual([
				{
					cause: "mint failed",
					command: mintCommand.join(" "),
					status: 1,
					detail: "<urlopen error timed out>",
				},
				{
					owner: "acme",
					cause: "missing",
					path: join(folder, "acme", "hosts.yml"),
				},
			]);
			const reads = forOwner(githubCalls(recorded), "acme");
			expect(reads.length).toBeGreaterThan(0);
			expect(reads.every((item) => item.authorization === userBearer)).toBe(
				true,
			);
		} finally {
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a settings read answers while the poll waits on a mint that does not finish", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		let started: () => void = () => {};
		const mintStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		let finish: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const recorded: Recorded[] = [];
		const answered = recordingFetch(recorded, {});
		const app = await serve({
			config: {
				factoryGithubTokens: true,
				factoryGithubTokenDir: join(home, "tokens"),
				factoryMintCommand: mintCommand,
				tracked: [{ tracker: "github", owner: "acme", project: 4 }],
			},
			fetchImpl: async (input, init) => {
				const body = typeof init?.body === "string" ? init.body : "";
				if (body.includes("ProjectByNumber")) {
					return Response.json({ data: { repositoryOwner: null } });
				}
				return answered(input, init);
			},
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			home,
			mint: async () => {
				started();
				await held;
				return { status: 1, stderr: "" };
			},
			beforeFirstPoll: true,
		});
		try {
			await mintStarted;
			const sent = performance.now();
			const response = await fetch(new URL("/api/settings", app.base));
			expect(response.status).toBe(200);
			expect(performance.now() - sent).toBeLessThan(10_000);
		} finally {
			finish();
			await app.stop();
			await rm(home, { recursive: true, force: true });
		}
	}, 15_000);
});
