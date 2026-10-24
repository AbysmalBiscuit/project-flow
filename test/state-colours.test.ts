import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import type { Configuration } from "../src/configuration.ts";
import { run } from "../src/main.ts";
import {
	defaultStateColours,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
	writtenColours,
} from "./support.ts";

async function withAppFile(
	path: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-colours-"));
	const requests: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			check(base, path, requests).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
				},
				fetch: async (input, init) => {
					const url = urlOf(input);
					requests.push(url);
					if (url === "https://api.github.com/user") {
						return Response.json({ login: "lev" });
					}
					return recordedDiscovery(input, init) ?? unrecorded(input);
				},
				readGhToken: async () => null,
				listCheckouts: async () => [],
				databasePath: join(root, "project-flow.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function withApp(
	body: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
): Promise<void> {
	const { path, cleanup } = await tempConfig(body);
	try {
		await withAppFile(path, check);
	} finally {
		await cleanup();
	}
}

describe("state colours", () => {
	test("the first start writes the default state colours into a fresh configuration file", async () => {
		await withApp(JSON.stringify({}), async (base, path) => {
			expect(await writtenColours(path)).toEqual(defaultStateColours);
			const settings = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(settings.stateColours).toEqual(defaultStateColours);
		});
	});

	test("a partial colour set gets the missing defaults written at start", async () => {
		await withApp(
			JSON.stringify({ stateColours: { done: "#123456" } }),
			async (_base, path) => {
				expect(await writtenColours(path)).toEqual({
					...defaultStateColours,
					done: "#123456",
				});
			},
		);
	});

	test("a saved state colour reaches the settings API and the page, sends no tracker request, and survives a restart", async () => {
		const { path, cleanup } = await tempConfig(JSON.stringify({}));
		try {
			await withAppFile(path, async (base, _path, requests) => {
				const before = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				const sent = requests.length;
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						stateColours: { ...before.stateColours, inProgress: "#FF0066" },
					}),
				});
				expect(saved.status).toBe(200);
				expect(requests.length).toBe(sent);
				const written = (await saved.json()) as Configuration;
				expect(written.stateColours).toEqual({
					...defaultStateColours,
					inProgress: "#ff0066",
				});
				const page = await (await fetch(new URL("/", base))).text();
				expect(page).toContain('"inProgress":"#ff0066"');
			});
			await withAppFile(path, async (base) => {
				const restarted = (await (
					await fetch(new URL("/api/settings", base))
				).json()) as Configuration;
				expect(restarted.stateColours.inProgress).toBe("#ff0066");
			});
			expect(await writtenColours(path)).toEqual({
				...defaultStateColours,
				inProgress: "#ff0066",
			});
		} finally {
			await cleanup();
		}
	}, 30_000);

	test("a blank, short or named colour names the field and leaves the file", async () => {
		await withApp(JSON.stringify({}), async (base, path) => {
			const before = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			for (const colour of ["", "  ", "#12345", "red", "#12345g"]) {
				const saved = await fetch(new URL("/api/settings", base), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...before,
						stateColours: { ...before.stateColours, done: colour },
					}),
				});
				expect(saved.status).toBe(400);
				const body = (await saved.json()) as { error: string };
				expect(body.error).toContain("stateColours.done");
			}
			expect(await writtenColours(path)).toEqual(defaultStateColours);
		});
	});
});
