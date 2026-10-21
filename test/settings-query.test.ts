import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Window } from "happy-dom";
import type { Configuration } from "../src/configuration.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import stylexPlugin from "../src/stylex-plugin.ts";
import {
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const pageBundle = join(import.meta.dir, "settings-page-bundle.js");

type PageModule = {
	Page: () => unknown;
	PageQueryRoot: (props: { children: unknown }) => unknown;
	pageQuery: { settings: { queryKey: readonly unknown[] } };
	pageQueryClient: {
		getQueryData: (key: readonly unknown[]) => unknown;
		clear: () => void;
	};
	wirePageQueryEvents: () => void;
	createElement: (
		type: unknown,
		props: object | null,
		child?: unknown,
	) => unknown;
	createRoot: (host: unknown) => { render: (node: unknown) => void };
};

type PageWindow = Window & {
	happyDOM: {
		waitUntilComplete: () => Promise<void>;
		close: () => Promise<void>;
	};
};

const windows: PageWindow[] = [];
const appFetch = fetch;

beforeAll(async () => {
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, "settings-page-entry.ts")],
		target: "browser",
		format: "esm",
		plugins: [stylexPlugin],
	});
	if (!built.success) {
		throw new Error(built.logs.map((item) => item.message).join("\n"));
	}
	const output = built.outputs[0];
	if (output === undefined) {
		throw new Error("settings page bundle is missing");
	}
	await Bun.write(pageBundle, await output.text());
});

afterEach(async () => {
	for (const window of windows.splice(0)) {
		await window.happyDOM.close();
	}
	globalThis.fetch = appFetch;
});

function recordedFetch(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === "https://api.linear.app/graphql") {
			return Response.json({
				data: {
					viewer: { id: "lev" },
					projects: { nodes: [], pageInfo: { hasNextPage: false } },
				},
			});
		}
		return unrecorded(input, init);
	};
}

async function withApp(check: (base: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-settings-query-"));
	const { path, cleanup } = await tempConfig(JSON.stringify({ tracked: [] }));
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			check(base).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: recordedFetch(),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

async function openSettings(
	base: string,
	settingsGet: (appFetch: Fetch) => Promise<Response> | Response,
): Promise<{
	window: PageWindow;
	log: { method: string; path: string }[];
	page: PageModule;
	deliver: (name: string, data: string) => void;
}> {
	const origin = new URL(base).origin;
	const window = new Window({
		url: new URL("/settings", base).href,
	}) as PageWindow;
	windows.push(window);
	const globals = globalThis as Record<string, unknown>;
	for (const key of [
		"document",
		"HTMLElement",
		"Element",
		"Node",
		"Event",
		"navigator",
		"MutationObserver",
		"DocumentFragment",
		"Text",
		"Comment",
		"customElements",
		"HTMLButtonElement",
		"HTMLSelectElement",
		"HTMLInputElement",
	] as const) {
		globals[key] = window[key];
	}
	globals.window = window;
	globals.getComputedStyle = window.getComputedStyle.bind(window);
	globals.requestAnimationFrame = (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 0);
	globals.cancelAnimationFrame = (id: number) => clearTimeout(id);
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	globals.EventSource = class {
		addEventListener(name: string, listener: (event: unknown) => void): void {
			const current = listeners.get(name) ?? new Set();
			current.add(listener);
			listeners.set(name, current);
		}
		removeEventListener(): void {}
		close(): void {}
	};
	const log: { method: string; path: string }[] = [];
	globals.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const raw =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const target = raw.startsWith("/") ? new URL(raw, origin) : new URL(raw);
		const method = init?.method ?? "GET";
		if (target.origin === origin) {
			log.push({ method, path: target.pathname });
		}
		const response =
			target.pathname === "/api/settings" && method === "GET"
				? await settingsGet(appFetch)
				: await appFetch(target, init);
		if (target.pathname === "/api/settings") {
			return new Response(await response.text(), {
				status: response.status,
				headers: { "content-type": "application/json" },
			});
		}
		return response;
	};
	window.document.body.innerHTML = '<div id="root"></div>';
	const page = (await import(
		`${pageBundle}?page=${crypto.randomUUID()}`
	)) as PageModule;
	page.pageQueryClient.clear();
	page.wirePageQueryEvents();
	const host = window.document.getElementById("root");
	if (host === null) {
		throw new Error("settings root is missing");
	}
	page
		.createRoot(host)
		.render(
			page.createElement(
				page.PageQueryRoot,
				null,
				page.createElement(page.Page, null),
			),
		);
	await Bun.sleep(150);
	return {
		window,
		log,
		page,
		deliver: (name, data) => {
			const event: unknown = new window.MessageEvent(name, { data });
			for (const listener of listeners.get(name) ?? []) {
				listener(event);
			}
		},
	};
}

async function settle(window: PageWindow): Promise<void> {
	await window.happyDOM.waitUntilComplete();
	await Bun.sleep(80);
}

function changeInterval(window: PageWindow, seconds: string): void {
	const interval = window.document.querySelector("#poll-interval");
	if (!(interval instanceof window.HTMLSelectElement)) {
		throw new Error(
			`poll interval is missing: ${(window.document.body.textContent ?? "").slice(0, 160)}`,
		);
	}
	interval.value = seconds;
	interval.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function clickSave(window: PageWindow): void {
	const save = window.document.querySelector("#save-settings");
	if (!(save instanceof window.HTMLButtonElement)) {
		throw new Error("save button is missing");
	}
	save.click();
}

describe("settings query client", () => {
	test("a failed settings read before a save keeps the draft and sends no write", async () => {
		await withApp(async (base) => {
			let failRead = false;
			const opened = await openSettings(base, (appFetch) => {
				if (failRead) {
					return Response.json(
						{ error: "settings unavailable" },
						{ status: 503 },
					);
				}
				return appFetch(new URL("/api/settings", base));
			});
			const text = () => opened.window.document.body.textContent ?? "";
			expect(text()).toContain("5 minutes");
			changeInterval(opened.window, "60");
			failRead = true;
			clickSave(opened.window);
			await settle(opened.window);
			expect(text()).toContain("1 minute");
			expect(text()).not.toContain("Loading");
			expect(opened.log.filter((item) => item.method === "PUT")).toEqual([]);
			expect(text()).toContain("settings unavailable");
			const stored = (await (
				await appFetch(new URL("/api/settings", base))
			).json()) as Configuration;
			expect(stored.pollIntervalSeconds).toBe(300);
		});
	});

	test("an overview event refreshes settings from the server", async () => {
		await withApp(async (base) => {
			const current = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Configuration;
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...current, pollIntervalSeconds: 60 }),
			});
			expect(saved.status).toBe(200);
			const opened = await openSettings(base, (appFetch) =>
				appFetch(new URL("/api/settings", base)),
			);
			const before = opened.log.filter(
				(item) => item.method === "GET" && item.path === "/api/settings",
			).length;
			const events = await appFetch(new URL("/api/events", base), {
				headers: { accept: "text/event-stream" },
			});
			const reader = events.body?.getReader();
			if (reader === undefined) {
				throw new Error("event stream has no body");
			}
			const refresh = await appFetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			let frame = "";
			const started = Date.now();
			while (
				!frame.includes("event: overview") &&
				Date.now() - started < 1_500
			) {
				const chunk = await Promise.race([
					reader.read(),
					Bun.sleep(100).then(() => ({
						done: false,
						value: undefined,
					})),
				]);
				if (chunk.value !== undefined) {
					frame += new TextDecoder().decode(chunk.value);
				}
			}
			await reader.cancel();
			expect(frame).toContain("event: overview");
			const payload = frame
				.slice(frame.lastIndexOf("data:") + "data:".length)
				.trim();
			opened.deliver("overview", payload);
			await settle(opened.window);
			const after = opened.log.filter(
				(item) => item.method === "GET" && item.path === "/api/settings",
			).length;
			expect(after).toBeGreaterThan(before);
			expect(opened.window.document.body.textContent).toContain("1 minute");
		});
	});

	test("a settings save cache holds settings, trackers and projects only", async () => {
		await withApp(async (base) => {
			const opened = await openSettings(base, (pageFetch) =>
				pageFetch(new URL("/api/settings", base)),
			);
			changeInterval(opened.window, "60");
			clickSave(opened.window);
			await settle(opened.window);
			const cached = opened.page.pageQueryClient.getQueryData(
				opened.page.pageQuery.settings.queryKey,
			) as Record<string, unknown> | undefined;
			expect(cached).toBeDefined();
			if (cached === undefined) {
				return;
			}
			expect(cached).toEqual(
				expect.objectContaining({ pollIntervalSeconds: 60 }),
			);
			expect(cached).not.toHaveProperty("baselineTracked");
			expect(cached).toHaveProperty("trackers");
			expect(cached).toHaveProperty("projects");
			const written = (await (
				await fetch(new URL("/api/settings", base))
			).json()) as Record<string, unknown>;
			expect(written.pollIntervalSeconds).toBe(60);
			expect(written).not.toHaveProperty("baselineTracked");
		});
	});
});
