import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import daemonSources from "./fixtures/factory-daemon-sources.json";
import daemonAbout from "./fixtures/factory-daemon.json";
import hubRuns from "./fixtures/factory-hub-runs.json";
import hubSources from "./fixtures/factory-hub-sources.json";
import {
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

export const hubUrl = "http://hub.test:7777";
export const laptopSocket = "/run/factory/laptop.sock";
export const laptopUrl = `unix://${laptopSocket}`;

export type FactoryRequest = {
	url: string;
	unix: string | null;
	method: string;
	body?: string;
	lastEventId?: string;
};

const writePaths = [
	/^\/runs\/[^/]+\/questions\/[^/]+\/answer$/,
	/^\/runs\/[^/]+\/steer$/,
	/^\/runs\/[^/]+\/cancel$/,
];

/** True for a read, and for an answer, steer or cancel POST: the only writes that the app may send to a factory. */
export function readOrRunWrite(request: FactoryRequest): boolean {
	const { pathname } = new URL(request.url);
	return (
		request.method === "GET" ||
		(request.method === "POST" &&
			writePaths.some((path) => path.test(pathname)))
	);
}

/** The answer to each path. A function answer gives its body again on each request. */
export type Answers = Record<string, unknown | null>;

/** A hub `GET /events` stream that the test writes frames to and drops. */
export class EventFeed {
	connects = 0;
	#open: ReadableStreamDefaultController<Uint8Array> | null = null;

	answer(signal: AbortSignal | null | undefined): Response {
		this.connects += 1;
		const body = new ReadableStream<Uint8Array>({
			start: (controller) => {
				this.#open = controller;
				signal?.addEventListener("abort", () =>
					controller.error(signal.reason),
				);
			},
		});
		return new Response(body, {
			headers: { "content-type": "text/event-stream" },
		});
	}

	/** Send one frame, with an SSE `id` line when the frame has an `id`. */
	send(frame: unknown): void {
		const id =
			typeof frame === "object" && frame !== null && "id" in frame
				? `id: ${String(frame.id)}\n`
				: "";
		this.#open?.enqueue(
			new TextEncoder().encode(`${id}data: ${JSON.stringify(frame)}\n\n`),
		);
	}

	drop(): void {
		this.#open?.close();
		this.#open = null;
	}

	async connected(count: number): Promise<void> {
		while (this.connects < count) {
			await Bun.sleep(10);
		}
	}
}

export const hub: Answers = {
	"/daemon": daemonAbout,
	"/sources": hubSources,
	"/runs": hubRuns,
};

export const daemon: Answers = {
	"/daemon": daemonAbout,
	"/sources": daemonSources,
	"/runs": { runs: [] },
};

export function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
	});
}

/** Serves each factory's answers by its origin, or by its socket path. */
export function factoryFetch(
	factories: Record<string, Answers | "down">,
	requests: FactoryRequest[],
	other: Fetch = async (input, init) =>
		recordedDiscovery(input, init) ?? unrecorded(input, init),
): Fetch {
	return async (input, init) => {
		const url = new URL(urlOf(input));
		const unix = init?.unix ?? null;
		const key = unix === null ? url.origin : `unix://${unix}`;
		const answers = factories[key];
		if (answers === undefined) {
			return other(input, init);
		}
		const lastEventId = new Headers(init?.headers).get("last-event-id");
		requests.push({
			url: url.href,
			unix,
			method: init?.method ?? "GET",
			...(typeof init?.body === "string" ? { body: init.body } : {}),
			...(lastEventId === null ? {} : { lastEventId }),
		});
		if (answers === "down") {
			throw new TypeError("Unable to connect");
		}
		const answer = answers[url.pathname];
		const body = typeof answer === "function" ? answer() : answer;
		if (body instanceof EventFeed) {
			return body.answer(init?.signal);
		}
		if (body instanceof Response) {
			return body.clone();
		}
		return body === undefined || body === null
			? new Response("not found", { status: 404 })
			: json(body);
	};
}

export async function serve(
	args: string[],
	config: Record<string, unknown>,
	fetchImpl: Fetch,
	io: { env?: Record<string, string>; now?: () => Date } = {},
): Promise<{
	base: string;
	configPath: string;
	stop: () => Promise<void>;
}> {
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
		["--config", path, "--host", "127.0.0.1", "--port", "0", ...args],
		testIo({
			env: io.env ?? {},
			fetch: fetchImpl,
			readGhToken: async () => null,
			listCheckouts: async () => [],
			databasePath: join(root, "store.sqlite"),
			stdout: (line) => listened(line),
			waitForStop: stopped,
			runTickMs: 25,
			...(io.now === undefined ? {} : { now: io.now }),
		}),
	);
	const base = await ready;
	return {
		base,
		configPath: path,
		stop: async () => {
			stop();
			const result = await running;
			await cleanup();
			await rm(root, { recursive: true, force: true });
			expect(result.exitCode).toBe(0);
		},
	};
}
