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
			return 0;
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

	test("a failed mint shows its exit status in Settings, and the reads use the user token", async () => {
		const home = await mkdtemp(join("/var/tmp", "project-flow-factory-"));
		const folder = join(home, "tokens");
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
			mint: async () => 1,
		});
		try {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as { factoryTokenReports: FactoryTokenReport[] };
			expect(settings.factoryTokenReports).toEqual([
				{ cause: "mint failed", command: mintCommand.join(" "), status: 1 },
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
});
