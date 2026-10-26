import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FactoryEntry } from "../src/factories.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { daemon, factoryFetch, hubUrl } from "./factory-support.ts";
import { openEventStream } from "./live-support.ts";
import {
	emptyProjectFields,
	settledOverview,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

type SettingsBody = {
	projects: { name: string; key: string; tracked: boolean }[];
	factoryEntries: FactoryEntry[];
	expectedBots?: Record<string, string[]>;
};

const json = (body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

const viewerProjects = (titles: string[]): Response =>
	json({
		data: {
			viewer: {
				login: "lev",
				projectsV2: {
					nodes: titles.map((title, index) => ({
						id: `PVT_${index}`,
						number: 4 + index,
						title,
						closed: false,
						updatedAt: "2026-10-18T12:00:00.000Z",
						owner: { login: "lev" },
					})),
					pageInfo: { hasNextPage: false, endCursor: null },
				},
				organizations: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		},
	});

const pushedRepo = (fullName: string) => ({
	full_name: fullName,
	owner: { login: "lev" },
	permissions: { push: true },
	pushed_at: "2026-10-18T12:00:00.000Z",
});

/** Answers the GitHub reads of a poll, with `discover` for the catalogue reads. */
function trackerFetch(discover: {
	boards: () => Promise<Response>;
	repos: () => Promise<Response>;
	items?: () => Promise<void>;
}): Fetch {
	return async (input, init) => {
		const url = urlOf(input);
		const body = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			body.includes("ViewerProjects")
		) {
			return discover.boards();
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return discover.repos();
		}
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		if (url === "https://api.github.com/graphql") {
			if (body.includes("ProjectItems")) {
				await discover.items?.();
			}
			return (
				emptyProjectFields(input, init) ??
				json({
					data: {
						node: {
							items: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				})
			);
		}
		return unrecorded(input);
	};
}

async function start(
	config: Record<string, unknown>,
	fetchImpl: Fetch,
): Promise<{ base: string; stop: () => Promise<void> }> {
	const { path, cleanup } = await tempConfig(JSON.stringify(config));
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
	let listened: (base: string) => void = () => {};
	const ready = new Promise<string>((resolve) => {
		listened = resolve;
	});
	let stop: () => void = () => {};
	const stopped = new Promise<void>((resolve) => {
		stop = resolve;
	});
	const running = run(
		["--config", path, "--host", "127.0.0.1", "--port", "0"],
		testIo(
			{
				env: { GITHUB_TOKEN: "recorded-token" },
				fetch: fetchImpl,
				readGhToken: async () => null,
				listCheckouts: async () => [],
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => listened(line),
				waitForStop: stopped,
				runTickMs: 25,
			},
			{ first: true },
		),
	);
	const base = await ready;
	return {
		base,
		stop: async () => {
			stop();
			await running;
			await cleanup();
			await rm(root, { recursive: true, force: true });
		},
	};
}

/** A read that answers inside this limit did not wait on the fake that never answers. */
const answerLimitMs = 1_000;

async function answeredAtOnce(url: URL): Promise<Response> {
	const answer = await Promise.race([
		fetch(url),
		Bun.sleep(answerLimitMs).then(() => null),
	]);
	if (answer === null) {
		throw new Error(`${url.pathname} waited on a poll or a factory`);
	}
	return answer;
}

test("no API read waits on discovery, a tracker read or a factory call that never answers", async () => {
	// The fake answers no call until teardown, so the poll can end and the app stops.
	let hangUp: () => void = () => {};
	const hanging = new Promise<Response>((_, reject) => {
		hangUp = () => reject(new TypeError("Unable to connect"));
	});
	const fetchImpl: Fetch = () => hanging;
	const app = await start(
		{
			pollIntervalSeconds: 3600,
			factories: [{ name: "work hub", url: hubUrl }],
		},
		fetchImpl,
	);
	try {
		const run = "20261025-140102-a1b2";
		const reads = [
			"/api/overview",
			"/api/needs-you",
			"/api/inbox",
			"/api/search?q=ship",
			"/api/settings",
			"/api/projects/acme%2Fwidget",
			"/api/factory-runs",
			`/api/factory-runs/${run}`,
			`/api/factory-runs/${run}/checkpoint`,
			`/api/factory-runs/${run}/agents`,
			"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
		];
		const answers = await Promise.all(
			reads.map((path) => answeredAtOnce(new URL(path, app.base))),
		);
		expect(answers.map((answer) => answer.status < 500)).toEqual(
			reads.map(() => true),
		);
		const settings = (await (
			await answeredAtOnce(new URL("/api/settings", app.base))
		).json()) as SettingsBody;
		expect(settings.factoryEntries).toMatchObject([
			{ url: hubUrl, reachable: null },
		]);
		const thread = await answeredAtOnce(
			new URL(
				"/api/threads/github/acme%2Fwidget%237?project=acme%2Fwidget",
				app.base,
			),
		);
		expect(thread.status).toBe(202);
		expect(await thread.json()).toEqual({ pending: true });
	} finally {
		hangUp();
		await app.stop();
	}
});

test("the settings read answers during discovery and a factory check, and the events after them bring the catalogue and the factory state", async () => {
	let releaseDiscovery: () => void = () => {};
	const discoveryHeld = new Promise<void>((resolve) => {
		releaseDiscovery = resolve;
	});
	let releaseFactory: () => void = () => {};
	const factoryHeld = new Promise<void>((resolve) => {
		releaseFactory = resolve;
	});
	const answered = factoryFetch(
		{ [hubUrl]: daemon },
		[],
		trackerFetch({
			boards: async () => {
				await discoveryHeld;
				return viewerProjects(["Local board"]);
			},
			repos: async () => json([]),
		}),
	);
	const fetchImpl: Fetch = async (input, init) => {
		if (new URL(urlOf(input)).origin === hubUrl) {
			await factoryHeld;
		}
		return answered(input, init);
	};
	const app = await start(
		{
			pollIntervalSeconds: 3600,
			factories: [{ name: "work hub", url: hubUrl }],
		},
		fetchImpl,
	);
	const stream = openEventStream(app.base);
	try {
		await stream.ready;
		const early = (await (
			await answeredAtOnce(new URL("/api/settings", app.base))
		).json()) as SettingsBody;
		expect(early.projects).toEqual([]);
		expect(early.factoryEntries).toMatchObject([{ reachable: null }]);
		releaseDiscovery();
		releaseFactory();
		let late: SettingsBody | null = null;
		for await (const event of stream.events) {
			if (event.event !== "overview") {
				continue;
			}
			late = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as SettingsBody;
			if (
				late.projects.length > 0 &&
				late.factoryEntries.every((entry) => entry.reachable !== null)
			) {
				break;
			}
		}
		expect(late?.projects.map((project) => project.name)).toEqual([
			"Local board",
		]);
		expect(late?.factoryEntries).toMatchObject([
			{ url: hubUrl, reachable: true, kind: "daemon" },
		]);
	} finally {
		releaseDiscovery();
		releaseFactory();
		stream.close();
		await app.stop();
	}
});

test("a tracked-list write during discovery sees that poll's catalogue", async () => {
	let repoReads = 0;
	let noteRefreshAsked: () => void = () => {};
	const refreshAsked = new Promise<void>((resolve) => {
		noteRefreshAsked = resolve;
	});
	let releaseRefresh: () => void = () => {};
	const refreshHeld = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	const app = await start(
		{ pinned: [], pollIntervalSeconds: 3600 },
		trackerFetch({
			boards: async () => viewerProjects([]),
			repos: async () => {
				repoReads += 1;
				if (repoReads === 1) {
					return json([]);
				}
				noteRefreshAsked();
				await refreshHeld;
				return json([pushedRepo("lev/new-repo")]);
			},
		}),
	);
	try {
		await settledOverview(
			app.base,
			async (base) =>
				(await (await fetch(new URL("/api/overview", base))).json()) as {
					polling?: true;
				},
		);
		const refresh = await fetch(new URL("/api/refresh", app.base), {
			method: "POST",
		});
		expect(refresh.status).toBe(204);
		await refreshAsked;
		const write = fetch(new URL("/api/settings", app.base), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pinned: [],
				pollIntervalSeconds: 3600,
				tracked: [{ tracker: "github", repo: "lev/new-repo" }],
				expectedBots: { "lev/new-repo": ["grok"] },
			}),
		});
		await Bun.sleep(30);
		releaseRefresh();
		const saved = await write;
		const body = (await saved.json()) as SettingsBody;
		expect(saved.status).toBe(200);
		expect(body.expectedBots).toEqual({ "lev/new-repo": ["grok"] });
		expect(
			body.projects.find((project) => project.key === "lev/new-repo"),
		).toMatchObject({ tracked: true });
	} finally {
		releaseRefresh();
		await app.stop();
	}
});

test("a tracked-list write after a refresh queued behind a poll waits for that refresh's catalogue", async () => {
	let boardReads = 0;
	let itemReads = 0;
	let noteItemsAsked: () => void = () => {};
	const itemsAsked = new Promise<void>((resolve) => {
		noteItemsAsked = resolve;
	});
	let releaseItems: () => void = () => {};
	const itemsHeld = new Promise<void>((resolve) => {
		releaseItems = resolve;
	});
	let noteRefreshAsked: () => void = () => {};
	const refreshAsked = new Promise<void>((resolve) => {
		noteRefreshAsked = resolve;
	});
	let releaseRefresh: () => void = () => {};
	const refreshHeld = new Promise<void>((resolve) => {
		releaseRefresh = resolve;
	});
	const app = await start(
		{
			pinned: [],
			pollIntervalSeconds: 3600,
			tracked: [{ tracker: "github", owner: "lev", project: 4 }],
		},
		trackerFetch({
			boards: async () => {
				boardReads += 1;
				if (boardReads === 1) {
					return viewerProjects(["Local board"]);
				}
				noteRefreshAsked();
				await refreshHeld;
				return viewerProjects(["Local board", "Other board"]);
			},
			repos: async () => json([]),
			items: async () => {
				itemReads += 1;
				if (itemReads === 1) {
					noteItemsAsked();
					await itemsHeld;
				}
			},
		}),
	);
	try {
		await itemsAsked;
		const refresh = await fetch(new URL("/api/refresh", app.base), {
			method: "POST",
		});
		expect(refresh.status).toBe(204);
		const write = fetch(new URL("/api/settings", app.base), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pinned: [],
				pollIntervalSeconds: 3600,
				tracked: [
					{ tracker: "github", owner: "lev", project: 4 },
					{ tracker: "github", owner: "lev", project: 5 },
				],
			}),
		});
		let settled = false;
		void write.then(() => {
			settled = true;
		});
		releaseItems();
		await refreshAsked;
		expect(settled).toBe(false);
		releaseRefresh();
		const saved = await write;
		expect(saved.status).toBe(200);
		const body = (await saved.json()) as SettingsBody;
		expect(
			body.projects
				.filter((project) => project.tracked)
				.map((project) => project.name),
		).toEqual(["Local board", "Other board"]);
	} finally {
		releaseItems();
		releaseRefresh();
		await app.stop();
	}
});
