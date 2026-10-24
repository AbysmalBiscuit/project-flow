import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Overview } from "../src/domain.ts";
import { run } from "../src/main.ts";
import { recordedViewer, unrecorded } from "../test/support.ts";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2];
if (port === undefined || !/^\d+$/.test(port)) {
	console.error("usage: bun proof/serve-factory-tokens.ts PORT");
	process.exit(1);
}

const stops = proofStops();
const data = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const configPath = join(data, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify(
		{
			tracked: [],
			checkoutRoots: [],
			pollIntervalSeconds: 3600,
			factoryGithubTokens: false,
		},
		null,
		"\t",
	)}\n`,
);

let upstream: URL | null = null;
const stopped = new AbortController();

function proxy(request: Request): Promise<Response> {
	const target = upstream;
	if (target === null) {
		return Promise.resolve(new Response("loading", { status: 503 }));
	}
	const url = new URL(request.url);
	url.protocol = target.protocol;
	url.hostname = target.hostname;
	url.port = target.port;
	const headers = new Headers(request.headers);
	headers.delete("host");
	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	return fetch(url, {
		method: request.method,
		headers,
		...(hasBody ? { body: request.body } : {}),
	});
}

const gate = Bun.serve({
	hostname: "127.0.0.1",
	port: Number(port),
	fetch: proxy,
});

let appBase = "";
const ready = (async () => {
	const deadline = Date.now() + 9_000;
	while (upstream === null && Date.now() < deadline) {
		if (appBase !== "") {
			const loaded = await fetch(new URL("/api/overview", appBase)).catch(
				() => null,
			);
			if (loaded?.ok) {
				const body = (await loaded.json()) as Pick<Overview, "polling">;
				if (body.polling !== true) {
					upstream = new URL(appBase);
					return;
				}
			}
		}
		await Bun.sleep(50);
	}
	if (upstream === null) {
		console.error("proof server was not ready within 9s");
		gate.stop(true);
		process.exitCode = 1;
		await rm(data, { recursive: true, force: true });
		stopped.abort();
	}
})();
void ready;

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "0"],
	{
		env: {
			...process.env,
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: data,
		},
		fetch: async (input, init) => {
			if (stopped.signal.aborted) {
				throw new Error("proof server was not ready within 9s");
			}
			const recorded = recordedViewer(input, init);
			if (recorded !== null) {
				return recorded;
			}
			const url = String(input instanceof Request ? input.url : input);
			if (url === "https://api.linear.app/graphql") {
				return new Response(
					JSON.stringify({
						data: {
							viewer: { id: "lev" },
							projects: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.startsWith("https://api.github.com/")) {
				return new Response("[]", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return unrecorded(input);
		},
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(data, "project-flow.sqlite"),
		stdout: (line) => {
			appBase = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: (async () => {
			await Promise.race([
				stops,
				new Promise<void>((resolve) => {
					stopped.signal.addEventListener("abort", () => resolve(), {
						once: true,
					});
				}),
			]);
			gate.stop(true);
			await rm(data, { recursive: true, force: true });
		})(),
	},
);
process.exit(process.exitCode ?? result.exitCode);
