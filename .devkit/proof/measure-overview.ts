// Serve a copy of the store from one checkout, with no outside network, and time GET /api/overview.
// Usage: bun run measure-overview.ts <checkout> <store.sqlite> <config.json> [reads]
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [checkout, store, config, readsArg] = process.argv.slice(2);
if (checkout === undefined || store === undefined || config === undefined) {
	throw new Error("usage: measure-overview.ts <checkout> <store> <config>");
}
const reads = Number(readsArg ?? "20");
const { run } = (await import(join(checkout, "src/main.ts"))) as typeof import("../../src/main.ts");

const root = await mkdtemp(join(tmpdir(), "pf-measure-"));
const dataHome = join(root, "data");
await mkdir(join(dataHome, "project-flow"), { recursive: true });
const databasePath = join(dataHome, "project-flow", "project-flow.sqlite");
await copyFile(store, databasePath);
const configPath = join(root, "config.json");
const parsed = (await Bun.file(config).json()) as Record<string, unknown>;
// No write path: no auto-merge, no PM bot, no factories, a long poll interval.
const {
	autoMerge: _autoMerge,
	pmBot: _pmBot,
	factoryGithubTokens: _tokens,
	factoryGithubTokenDir: _tokenDir,
	...kept
} = parsed;
await Bun.write(
	configPath,
	JSON.stringify({ ...kept, pollIntervalSeconds: 86_400 }),
);

const offline = async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
		return fetch(input, init);
	}
	throw new TypeError(`offline: ${url}`);
};

let stop = () => {};
const stopped = new Promise<void>((resolve) => {
	stop = resolve;
});
let listening: (base: string) => void = () => {};
const ready = new Promise<string>((resolve) => {
	listening = resolve;
});
const app = run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
	env: { XDG_DATA_HOME: dataHome, XDG_CONFIG_HOME: join(root, "config-home") },
	fetch: offline,
	readGhToken: async () => null,
	databasePath,
	stdout: (line) => listening(line),
	stderr: () => {},
	waitForStop: stopped,
	listTodos: async () => "",
	listCheckouts: async () => [],
});
const base = await ready;
while (true) {
	const body = (await (await fetch(new URL("/api/overview", base))).json()) as {
		polling?: true;
	};
	if (body.polling !== true) {
		break;
	}
	await Bun.sleep(50);
}
const sizes: number[] = [];
const times: number[] = [];
for (let index = 0; index < reads; index += 1) {
	const started = performance.now();
	const text = await (await fetch(new URL("/api/overview", base))).text();
	times.push(performance.now() - started);
	sizes.push(Buffer.byteLength(text));
}
const sorted = [...times].sort((left, right) => left - right);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
console.log(
	JSON.stringify({
		checkout,
		bytes: sizes[sizes.length - 1],
		medianMs: Number(median.toFixed(1)),
		minMs: Number((sorted[0] ?? 0).toFixed(1)),
		reads,
	}),
);
if (process.env.HOLD === "1") {
	console.log(`serving ${base}`);
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
} else {
	stop();
}
await app;
await rm(root, { recursive: true, force: true });
