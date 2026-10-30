import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedFetch } from "./_support.ts";

const host = "git.acme.dev";
const tokenEnv = "ACME_FORGE_TOKEN";
const hosts = [{ host, forge: "github", tokenEnv }];
const widget = { tracker: "github" as const, repo: "acme/widget" };
const hostedWidget = { ...widget, host };
const hostedGadget = { tracker: "github", repo: "acme/gadget", host };

type Settings = {
	tracked: unknown[];
	projects: { name: string; ref: unknown }[];
};

/** Starts the app on a configuration, and reads the overview and the settings of its first poll. */
async function readStarted(
	configuration: unknown,
	env: Record<string, string>,
	fetchImpl: Fetch,
	databasePath = ":memory:",
): Promise<{
	result: Awaited<ReturnType<typeof run>>;
	overview: Overview;
	settings: Settings;
}> {
	const { path, cleanup } = await tempConfig(JSON.stringify(configuration));
	let startChecks: (base: string) => void = () => {};
	const reads = new Promise<{ overview: Overview; settings: Settings }>(
		(resolve, reject) => {
			startChecks = (base) => {
				void (async () => {
					const overview = await fetch(new URL("/api/overview", base));
					const settings = await fetch(new URL("/api/settings", base));
					return {
						overview: (await overview.json()) as Overview,
						settings: (await settings.json()) as Settings,
					};
				})().then(resolve, reject);
			};
		},
	);
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => startChecks(line),
				waitForStop: reads.then(() => undefined),
			}),
		);
		if (!result.listened) {
			throw new Error(`startup exited ${result.exitCode}: ${result.stderr}`);
		}
		return { result, ...(await reads) };
	} finally {
		await cleanup();
	}
}

async function readLoadFailure(configuration: unknown): Promise<string> {
	const { path, cleanup } = await tempConfig(JSON.stringify(configuration));
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: recordedFetch(200),
				readGhToken: async () => null,
				waitForStop: Promise.resolve(),
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.listened).toBe(false);
		return result.stderr;
	} finally {
		await cleanup();
	}
}

function tokensSent(sent: { url: string; authorization: string | null }[]) {
	return sent.filter((request) =>
		request.authorization?.includes("self-hosted-secret"),
	);
}

function recordingFetch(
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

describe("a declared self-hosted host", () => {
	test("with no token names its env var on each of its projects, and other projects poll", async () => {
		const sent: { url: string; authorization: string | null }[] = [];
		const { result, overview } = await readStarted(
			{ hosts, tracked: [widget, hostedWidget, hostedGadget] },
			{ GITHUB_TOKEN: "recorded-token" },
			recordingFetch(sent),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const missing = `${tokenEnv} is missing: set ${tokenEnv} to read ${host}.`;
		const errors = Object.fromEntries(
			overview.projects.map((project) => [project.name, project.error]),
		);
		expect(errors).toEqual({
			"acme/widget": null,
			[`${host}/acme/widget`]: missing,
			[`${host}/acme/gadget`]: missing,
		});
		expect(overview.error).toBeNull();
		expect(sent.some((request) => request.url.includes(host))).toBe(false);
	});

	test("as the only project with no token keeps the app running", async () => {
		const { result, overview } = await readStarted(
			{ hosts, tracked: [hostedWidget] },
			{},
			recordedFetch(200),
		);
		expect(result.exitCode).toBe(0);
		expect(overview.projects[0]?.error).toContain(tokenEnv);
	});

	test("with a token that no backend can use sends the token nowhere", async () => {
		const sent: { url: string; authorization: string | null }[] = [];
		const { result, overview } = await readStarted(
			{ hosts, tracked: [widget, hostedWidget] },
			{ GITHUB_TOKEN: "recorded-token", [tokenEnv]: "self-hosted-secret" },
			recordingFetch(sent),
		);
		expect(result.exitCode).toBe(0);
		const hosted = overview.projects.find(
			(project) => project.name === `${host}/acme/widget`,
		);
		expect(hosted?.error).toBe(`the github forge cannot read ${host} yet.`);
		const plain = overview.projects.find(
			(project) => project.name === "acme/widget",
		);
		expect(plain?.error).toBeNull();
		expect(tokensSent(sent)).toEqual([]);
	});

	test("keeps its host on the pin in Settings", async () => {
		const { settings } = await readStarted(
			{ hosts, tracked: [hostedWidget] },
			{},
			recordedFetch(200),
		);
		expect(settings.tracked).toEqual([hostedWidget]);
		expect(settings.projects.map((project) => project.ref)).toEqual([
			hostedWidget,
		]);
	});
});

describe("a project on a declared host", () => {
	test("keeps its own row beside the same repo on github.com after a restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
		const databasePath = join(root, "project-flow.sqlite");
		const configuration = { hosts, tracked: [widget, hostedWidget] };
		const env = { GITHUB_TOKEN: "recorded-token" };
		try {
			await readStarted(configuration, env, recordedFetch(200), databasePath);
			const { overview } = await readStarted(
				configuration,
				env,
				recordedFetch(200),
				databasePath,
			);
			expect(overview.projects.map((project) => project.ref)).toEqual([
				widget,
				hostedWidget,
			]);
			expect(overview.projects[1]?.error).toContain(tokenEnv);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("survives a settings write of the settings that the API sent", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ hosts, tracked: [hostedWidget] }),
		);
		let written: Response | undefined;
		let reread: Settings | undefined;
		let stopped: Promise<void> = Promise.resolve();
		let release: () => void = () => {};
		try {
			await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {},
					fetch: recordedFetch(200),
					readGhToken: async () => null,
					databasePath: ":memory:",
					stdout: (line) => {
						stopped = (async () => {
							const url = new URL("/api/settings", line);
							const body = await (await fetch(url)).text();
							written = await fetch(url, { method: "PUT", body });
							reread = (await written.clone().json()) as Settings;
						})();
						release();
					},
					waitForStop: new Promise<void>((resolve) => {
						release = resolve;
					}).then(() => stopped),
				}),
			);
			expect(written?.status).toBe(200);
			expect(reread?.tracked).toEqual([hostedWidget]);
		} finally {
			await cleanup();
		}
	});
});

describe("the configuration of a host", () => {
	test("a pin on an undeclared host stops the load and names the field", async () => {
		const stderr = await readLoadFailure({ tracked: [hostedWidget] });
		expect(stderr).toContain("tracked.0.host");
	});

	test("declaring github.com stops the load", async () => {
		const stderr = await readLoadFailure({
			hosts: [{ host: "github.com", forge: "github", tokenEnv }],
		});
		expect(stderr).toContain("hosts.0.host");
	});

	test("declaring gitlab.com stops the load", async () => {
		const stderr = await readLoadFailure({
			hosts: [{ host: "gitlab.com", forge: "github", tokenEnv }],
		});
		expect(stderr).toContain("hosts.0.host");
	});

	test("declaring a host twice stops the load", async () => {
		const stderr = await readLoadFailure({ hosts: [...hosts, ...hosts] });
		expect(stderr).toContain("hosts.1.host");
	});

	test("a pin with host github.com is the same project as a pin with no host", async () => {
		const { result, overview, settings } = await readStarted(
			{ tracked: [{ ...widget, host: "github.com" }, widget] },
			{ GITHUB_TOKEN: "recorded-token" },
			recordedFetch(200),
		);
		expect(result.exitCode).toBe(0);
		expect(overview.projects.map((project) => project.name)).toEqual([
			"acme/widget",
		]);
		expect(overview.projects[0]?.error).toBeNull();
		expect(settings.projects.map((project) => project.ref)).toEqual([widget]);
	});

	test("a configuration file from before hosts loads without edits", async () => {
		const { result, overview, settings } = await readStarted(
			{
				pinned: [
					widget,
					{ tracker: "github", owner: "acme", project: 7 },
					{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" },
				],
				pollIntervalSeconds: 60,
			},
			{},
			recordedFetch(200),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(settings.tracked).toEqual([
			widget,
			{ tracker: "github", owner: "acme", project: 7 },
			{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" },
		]);
		expect(overview.projects.map((project) => project.ref)).toEqual([
			widget,
			{ tracker: "github", owner: "acme", project: 7 },
			{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" },
		]);
	});
});

describe("a rejected token stops the start and names its env var", () => {
	test("GITHUB_TOKEN", async () => {
		const { path, cleanup } = await tempConfig("{}");
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "rejected-token" },
					fetch: recordedFetch(401),
					readGhToken: async () => null,
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("GITHUB_TOKEN");
		} finally {
			await cleanup();
		}
	});

	test("LINEAR_API_KEY", async () => {
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
			}),
		);
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { LINEAR_API_KEY: "rejected-key" },
					fetch: async () =>
						new Response(JSON.stringify({ message: "recorded" }), {
							status: 401,
						}),
					readGhToken: async () => null,
					databasePath: ":memory:",
				}),
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("LINEAR_API_KEY");
		} finally {
			await cleanup();
		}
	});
});
