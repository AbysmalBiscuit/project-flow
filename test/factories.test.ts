import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import type { FactoryEntry } from "../src/factories.ts";
import { run } from "../src/main.ts";
import daemonAbout from "./fixtures/factory-daemon.json";
import { tempConfig, testIo } from "./support/app.ts";
import {
	type Answers,
	daemon,
	factoryFetch,
	type FactoryRequest,
	hub,
	hubUrl,
	laptopSocket,
	laptopUrl,
	serve,
} from "./support/factory.ts";
import { unrecorded } from "./support/github.ts";
import { openEventStream } from "./support/reads.ts";

async function factoryEntries(base: string): Promise<FactoryEntry[]> {
	const response = await fetch(new URL("/api/settings", base));
	expect(response.status).toBe(200);
	const body = (await response.json()) as { factoryEntries: FactoryEntry[] };
	return body.factoryEntries;
}

const configured = {
	factories: [
		{ name: "work hub", url: hubUrl },
		{ name: "laptop", url: laptopUrl },
	],
};

describe("factories", () => {
	test("settings lists a configured hub and daemon with their kind, source and reachable state", async () => {
		const requests: FactoryRequest[] = [];
		const app = await serve(
			[],
			configured,
			factoryFetch({ [hubUrl]: hub, [laptopUrl]: daemon }, requests),
		);
		try {
			expect(await factoryEntries(app.base)).toEqual([
				{
					name: "work hub",
					url: hubUrl,
					source: "config",
					reachable: true,
					kind: "hub",
					boxes: 2,
				},
				{
					name: "laptop",
					url: laptopUrl,
					source: "config",
					reachable: true,
					kind: "daemon",
					boxes: null,
				},
			]);
			const overview = await fetch(new URL("/api/overview", app.base));
			expect(await overview.json()).not.toHaveProperty("factoryUnreachable");
			expect(requests.every((request) => request.method === "GET")).toBe(true);
		} finally {
			await app.stop();
		}
	});

	test("a unix factory URL reaches the factory through the unix option of fetch", async () => {
		const requests: FactoryRequest[] = [];
		const app = await serve(
			[],
			{ factories: [{ name: "laptop", url: laptopUrl }] },
			factoryFetch({ [laptopUrl]: daemon }, requests),
		);
		try {
			await factoryEntries(app.base);
			const feedUrls = ["http://localhost/runs", "http://localhost/events"];
			expect(
				requests.filter((request) => !feedUrls.includes(request.url)),
			).toEqual([
				{ url: "http://localhost/daemon", unix: laptopSocket, method: "GET" },
				{ url: "http://localhost/sources", unix: laptopSocket, method: "GET" },
			]);
			for (const url of feedUrls) {
				expect(requests).toContainEqual({
					url,
					unix: laptopSocket,
					method: "GET",
				});
			}
		} finally {
			await app.stop();
		}
	});

	test.each([
		["an empty source list", daemon, "daemon"],
		["a 404", { ...daemon, "/sources": null }, "daemon"],
		["a source list", { ...hub }, "hub"],
	] as const)(
		"a factory without role whose /sources answers %s is a %s",
		async (_, answers, kind) => {
			const app = await serve(
				[],
				{ factories: [{ name: "desktop", url: hubUrl }] },
				factoryFetch({ [hubUrl]: answers }, []),
			);
			try {
				const [entry] = await factoryEntries(app.base);
				expect(entry?.kind).toBe(kind);
			} finally {
				await app.stop();
			}
		},
	);

	test("a factory that reports its role is not probed through /sources", async () => {
		const requests: FactoryRequest[] = [];
		const app = await serve(
			[],
			{ factories: [{ name: "desktop", url: hubUrl }] },
			factoryFetch(
				{
					[hubUrl]: {
						...daemon,
						"/daemon": { ...daemonAbout, role: "daemon" },
					},
				},
				requests,
			),
		);
		try {
			const [entry] = await factoryEntries(app.base);
			expect(entry?.kind).toBe("daemon");
			expect(
				requests
					.map((request) => request.url)
					.filter(
						(url) => url !== `${hubUrl}/runs` && url !== `${hubUrl}/events`,
					),
			).toEqual([`${hubUrl}/daemon`]);
		} finally {
			await app.stop();
		}
	});

	test("--factory given twice replaces the configured factories and leaves the file as it was", async () => {
		const requests: FactoryRequest[] = [];
		const desktopUrl = "http://desktop.test:7788";
		const deskSocket = "/run/factory/desk.sock";
		const app = await serve(
			["--factory", desktopUrl, "--factory", `unix://${deskSocket}`],
			configured,
			factoryFetch(
				{
					[hubUrl]: hub,
					[laptopUrl]: daemon,
					[desktopUrl]: daemon,
					[`unix://${deskSocket}`]: daemon,
				},
				requests,
			),
		);
		try {
			const before = await readFile(app.configPath, "utf8");
			expect(await factoryEntries(app.base)).toEqual([
				{
					name: "desktop.test:7788",
					url: desktopUrl,
					source: "flag",
					reachable: true,
					kind: "daemon",
					boxes: null,
				},
				{
					name: deskSocket,
					url: `unix://${deskSocket}`,
					source: "flag",
					reachable: true,
					kind: "daemon",
					boxes: null,
				},
			]);
			const settings = await fetch(new URL("/api/settings", app.base));
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				body: JSON.stringify(await settings.json()),
			});
			expect(saved.status).toBe(200);
			expect(await readFile(app.configPath, "utf8")).toBe(before);
			expect(JSON.parse(before).factories).toEqual(configured.factories);
			expect(
				requests.filter(
					(request) =>
						request.url.startsWith(hubUrl) || request.unix === laptopSocket,
				),
			).toEqual([]);
		} finally {
			await app.stop();
		}
	});

	test("--factory NAME=URL names the factory in settings and the runs list, and a bare URL keeps its host", async () => {
		const app = await serve(
			["--factory", `hub=${hubUrl}`, "--factory", laptopUrl],
			configured,
			factoryFetch({ [hubUrl]: hub, [laptopUrl]: daemon }, []),
		);
		try {
			expect(
				(await factoryEntries(app.base)).map(({ name, url }) => ({
					name,
					url,
				})),
			).toEqual([
				{ name: "hub", url: hubUrl },
				{ name: laptopSocket, url: laptopUrl },
			]);
			let rows: { factory: string }[] = [];
			while (rows.length === 0) {
				const response = await fetch(new URL("/api/factory-runs", app.base));
				expect(response.status).toBe(200);
				rows = (await response.json()) as { factory: string }[];
				await Bun.sleep(20);
			}
			expect(new Set(rows.map((row) => row.factory))).toEqual(new Set(["hub"]));
		} finally {
			await app.stop();
		}
	});

	for (const [value, message] of [
		[
			"ftp://hub.test",
			"invalid factory: --factory needs an http, https or unix URL",
		],
		[
			"hub=ftp://hub.test",
			"invalid factory: --factory needs an http, https or unix URL",
		],
		["hub=", "invalid factory: --factory needs an http, https or unix URL"],
		[` =${hubUrl}`, "invalid factory: --factory needs a name before ="],
	] as const) {
		test(`--factory ${value} exits 1 and does not listen`, async () => {
			const { path, cleanup } = await tempConfig("{}");
			try {
				const result = await run(
					["--config", path, "--factory", value],
					testIo({
						env: {},
						fetch: async (input, init) => unrecorded(input, init),
						readGhToken: async () => null,
						waitForStop: Promise.resolve(),
					}),
				);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toBe(message);
				expect(result.listened).toBe(false);
			} finally {
				await cleanup();
			}
		});
	}

	test("settings adds a factory to the configured list", async () => {
		const app = await serve(
			[],
			{},
			factoryFetch({ [hubUrl]: hub, [laptopUrl]: daemon }, []),
		);
		try {
			const settings = (await (
				await fetch(new URL("/api/settings", app.base))
			).json()) as Record<string, unknown>;
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				body: JSON.stringify({
					...settings,
					factories: [{ name: "work hub", url: hubUrl }],
				}),
			});
			expect(saved.status).toBe(200);
			const body = (await saved.json()) as { factoryEntries: FactoryEntry[] };
			expect(body.factoryEntries).toEqual([
				{
					name: "work hub",
					url: hubUrl,
					source: "config",
					reachable: true,
					kind: "hub",
					boxes: 2,
				},
			]);
			const written = JSON.parse(await readFile(app.configPath, "utf8"));
			expect(written.factories).toEqual([{ name: "work hub", url: hubUrl }]);
		} finally {
			await app.stop();
		}
	});

	test("a configured factory with a URL of another scheme is refused", async () => {
		const app = await serve([], {}, factoryFetch({}, []));
		try {
			const saved = await fetch(new URL("/api/settings", app.base), {
				method: "PUT",
				body: JSON.stringify({
					factories: [{ name: "ftp", url: "ftp://hub.test" }],
				}),
			});
			expect(saved.status).toBe(400);
			expect(await saved.json()).toEqual({
				error: "invalid configuration: factories.0.url",
			});
		} finally {
			await app.stop();
		}
	});

	test("an unreachable factory shows as unreachable, and as reachable after a later check succeeds", async () => {
		const factories: Record<string, Answers | "down"> = {
			[hubUrl]: "down",
			[laptopUrl]: daemon,
		};
		const app = await serve([], configured, factoryFetch(factories, []));
		const stream = openEventStream(app.base);
		try {
			const [down, laptop] = await factoryEntries(app.base);
			expect(down).toMatchObject({ reachable: false, kind: null });
			expect(laptop).toMatchObject({ reachable: true, kind: "daemon" });
			const overview = await fetch(new URL("/api/overview", app.base));
			expect(await overview.json()).toMatchObject({ factoryUnreachable: true });
			await stream.ready;
			factories[hubUrl] = hub;
			await fetch(new URL("/api/refresh", app.base), { method: "POST" });
			for await (const event of stream.events) {
				if (
					event.event === "overview" &&
					!("factoryUnreachable" in JSON.parse(event.data))
				) {
					break;
				}
			}
			const [up] = await factoryEntries(app.base);
			expect(up).toMatchObject({ reachable: true, kind: "hub", boxes: 2 });
		} finally {
			stream.close();
			await app.stop();
		}
	});
});
