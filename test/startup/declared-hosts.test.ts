import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview, Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import { pendingStatus } from "../../src/stale-reads.ts";
import { sqliteStore } from "../../src/store.ts";
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

/** Starts the app, and runs the checks against it. */
async function withStarted(
	configuration: unknown,
	checks: (base: string) => Promise<void>,
	fetchImpl: Fetch = recordedFetch(200),
	databasePath = ":memory:",
): Promise<void> {
	const { path, cleanup } = await tempConfig(JSON.stringify(configuration));
	let release: () => void = () => {};
	let finished: Promise<void> = Promise.resolve();
	const asked = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath,
				stdout: (line) => {
					finished = checks(line);
					release();
				},
				waitForStop: asked.then(() => finished),
			}),
		);
		await finished;
	} finally {
		await cleanup();
	}
}

const hostedName = `${host}/acme/widget`;

/** Runs the checks on an app whose store holds one row of the declared host. */
async function withHostedRow(
	row: Pick<Snapshot, "pulls" | "tickets">,
	configuration: Record<string, unknown>,
	checks: (base: string) => Promise<void>,
	fetchImpl?: Fetch,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-hosts-"));
	const databasePath = join(root, "project-flow.sqlite");
	const seeded = sqliteStore(databasePath);
	seeded.store.mergeTickets([
		{
			key: "acme/widget",
			name: hostedName,
			tracker: "github",
			host,
			branches: [],
			startedKeys: [],
			...row,
		},
	]);
	seeded.close();
	try {
		await withStarted(
			{ hosts, tracked: [hostedWidget], ...configuration },
			checks,
			fetchImpl,
			databasePath,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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

describe("the bot settings of a project on a declared host", () => {
	const hostedKey = `${host}/acme/widget`;
	const settingsUrl = (base: string) => new URL("/api/settings", base);

	type BotRow = {
		key: string;
		repos: string[];
		pmBot: boolean;
		expectedBots: string[];
		repoBots: Record<string, string[]>;
	};

	const botRows = (settings: unknown) => {
		const { projects } = settings as { projects: BotRow[] };
		return Object.fromEntries(projects.map((row) => [row.key, row]));
	};

	test("read apart from the settings of the same repo on github.com", async () => {
		const { settings } = await readStarted(
			{
				hosts,
				tracked: [widget, hostedWidget],
				expectedBots: {
					"acme/widget": ["codex"],
					[hostedKey]: ["grok"],
				},
				pmBot: { "acme/widget": false },
			},
			{ GITHUB_TOKEN: "recorded-token" },
			recordedFetch(200),
		);
		const rows = botRows(settings);
		expect(rows["acme/widget"]).toMatchObject({
			repos: ["acme/widget"],
			pmBot: false,
			expectedBots: ["codex"],
			repoBots: { "acme/widget": ["codex"] },
		});
		expect(rows[hostedKey]).toMatchObject({
			repos: [hostedKey],
			pmBot: true,
			expectedBots: ["grok"],
			repoBots: { [hostedKey]: ["grok"] },
		});
	});

	test("a settings write under the host key leaves the github.com row alone", async () => {
		await withStarted(
			{ hosts, tracked: [widget, hostedWidget] },
			async (base) => {
				const loaded = (await (
					await fetch(settingsUrl(base))
				).json()) as Record<string, unknown>;
				const saved = await fetch(settingsUrl(base), {
					method: "PUT",
					body: JSON.stringify({
						...loaded,
						pmBot: { [hostedKey]: false },
						expectedBots: { [hostedKey]: ["codex"] },
					}),
				});
				expect(saved.status).toBe(200);
				const rows = botRows(await saved.json());
				expect(rows[hostedKey]).toMatchObject({
					pmBot: false,
					expectedBots: ["codex"],
				});
				expect(rows["acme/widget"]).toMatchObject({
					pmBot: true,
					expectedBots: [],
				});
			},
		);
	});

	test("a settings write refuses the bare repo key of a repo on a declared host", async () => {
		await withStarted({ hosts, tracked: [hostedWidget] }, async (base) => {
			const loaded = (await (await fetch(settingsUrl(base))).json()) as Record<
				string,
				unknown
			>;
			const saved = await fetch(settingsUrl(base), {
				method: "PUT",
				body: JSON.stringify({
					...loaded,
					expectedBots: { "acme/widget": ["codex"] },
				}),
			});
			expect(saved.status).toBe(400);
			expect(await saved.json()).toEqual({
				error: "invalid configuration: expectedBots.acme/widget",
			});
		});
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

describe("a route to a project on a declared host", () => {
	const ticket = {
		id: "1",
		tracker: "github" as const,
		key: "acme/widget#1",
		title: "A ticket",
		state: "open" as const,
		stateReason: null,
		updatedAt: "2026-10-01T10:00:00.000Z",
		body: "",
		blockedBy: [],
		milestone: null,
		parent: null,
		labels: [],
	};
	const target = {
		tracker: "github",
		project: hostedName,
		key: "acme/widget#1",
	};

	async function expectNoHomeCall(
		ask: (base: string) => Promise<Response>,
		expected: unknown,
	): Promise<void> {
		const sent: { url: string; authorization: string | null }[] = [];
		await withHostedRow(
			{ pulls: [], tickets: [ticket] },
			{ tracked: [widget, hostedWidget] },
			async (base) => {
				const asked = sent.length;
				const response = await ask(base);
				expect(response.status).toBe(404);
				expect(await response.json()).toEqual(expected);
				expect(sent.slice(asked)).toEqual([]);
			},
			recordingFetch(sent),
		);
	}

	const post = (base: string, path: string, body: unknown) =>
		fetch(new URL(path, base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	test("a reply does not reach the home tracker", async () => {
		await expectNoHomeCall(
			(base) => post(base, "/api/replies", { ...target, body: "Done." }),
			{ error: "tracker unavailable" },
		);
	});

	test("a thread read does not reach the home tracker", async () => {
		await expectNoHomeCall(
			async (base) => {
				const url = new URL(
					`/api/threads/github/${encodeURIComponent(target.key)}?project=${encodeURIComponent(hostedName)}`,
					base,
				);
				let response = await fetch(url);
				while (response.status === pendingStatus) {
					await Bun.sleep(10);
					response = await fetch(url);
				}
				return response;
			},
			{ missing: true },
		);
	});

	test("a run start does not reach the home tracker", async () => {
		await expectNoHomeCall((base) => post(base, "/api/run-starts", target), {
			error: "tracker unavailable",
		});
	});
});
