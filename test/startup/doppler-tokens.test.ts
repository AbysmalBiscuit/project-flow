import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { linearFake } from "../support/linear.ts";

type DopplerRead = { project: string; config: string; secret: string };

type Settings = {
	dopplerTokens: unknown;
	trackers: { kind: string; credential: string; tokenEnv?: string }[];
};

const linearProject = "widget-launch-0d42ae5d46d0";

async function startWith(
	body: Record<string, unknown>,
	doppler: (read: DopplerRead) => Promise<string | null>,
	check: (base: string, authorizations: string[]) => Promise<void>,
): Promise<{ stderr: string }> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			tracked: [{ tracker: "linear", project: linearProject }],
			...body,
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-doppler-"));
	const authorizations: string[] = [];
	const linear = linearFake({});
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base, authorizations).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {},
				fetch: (input, init) => {
					if (urlOf(input).startsWith("https://api.linear.app/")) {
						const authorization = new Headers(init?.headers).get(
							"authorization",
						);
						if (authorization !== null) {
							authorizations.push(authorization);
						}
					}
					return linear(input, init);
				},
				readGhToken: async () => null,
				readDopplerSecret: doppler,
				listCheckouts: async () => [],
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.exitCode).toBe(0);
		return { stderr: result.stderr };
	} finally {
		await rm(root, { recursive: true, force: true });
		await cleanup();
	}
}

async function settingsOf(base: string): Promise<Settings> {
	return (await (
		await fetch(new URL("/api/settings", base))
	).json()) as Settings;
}

describe("tracker tokens from Doppler", () => {
	test("a tracker set to Doppler reads its token from the named secret at the start", async () => {
		const reads: DopplerRead[] = [];
		await startWith(
			{
				dopplerTokens: {
					linear: { project: "infra", config: "prd", secret: "LINEAR_KEY" },
				},
			},
			async (read) => {
				reads.push(read);
				return "doppler-linear-key";
			},
			async (base, authorizations) => {
				const linear = (await settingsOf(base)).trackers.find(
					(item) => item.kind === "linear",
				);
				expect(linear?.credential).toBe("present");
				expect(authorizations).toContain("doppler-linear-key");
			},
		);
		expect(reads).toEqual([
			{ project: "infra", config: "prd", secret: "LINEAR_KEY" },
		]);
	});

	test("a failed Doppler read leaves the token missing and says which secret failed", async () => {
		const { stderr } = await startWith(
			{
				dopplerTokens: {
					linear: { project: "infra", config: "prd", secret: "LINEAR_KEY" },
				},
			},
			async () => null,
			async (base) => {
				const linear = (await settingsOf(base)).trackers.find(
					(item) => item.kind === "linear",
				);
				expect(linear?.credential).toBe("missing");
			},
		);
		expect(stderr).toContain("LINEAR_KEY");
		expect(stderr).toContain("infra");
	});

	test("settings save the Doppler secret of a tracker and name the env var it replaces", async () => {
		await startWith(
			{
				dopplerTokens: {
					linear: { project: "infra", config: "dev", secret: "LINEAR_KEY" },
				},
			},
			async () => "doppler-linear-key",
			async (base) => {
				const before = await settingsOf(base);
				expect(
					before.trackers.find((item) => item.kind === "linear")?.tokenEnv,
				).toBe("LINEAR_API_KEY");
				const secret = {
					project: "infra",
					config: "prd",
					secret: "LINEAR_KEY",
				};
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						dopplerTokens: { linear: secret },
					}),
				});
				expect(saved.status).toBe(200);
				expect((await settingsOf(base)).dopplerTokens).toEqual({
					linear: secret,
				});
			},
		);
	});
});
