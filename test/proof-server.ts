import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { trackerRequest, unrecorded } from "./support.ts";

const port = process.argv.find((arg) => arg.startsWith("--port="))?.slice(7);
const data = process.argv.find((arg) => arg.startsWith("--data="))?.slice(7);
if (
	port === undefined ||
	!/^\d+$/.test(port) ||
	data === undefined ||
	data.trim() === ""
) {
	console.error("usage: bun test/proof-server.ts --port=N --data=DIR");
	process.exit(1);
}

const repos = ["acme/repo-1", "acme/repo-3"];

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const request = trackerRequest(input, init);
	const url = request.url;
	if (url === "https://api.github.com/user") {
		return json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return json(
			repos.map((repo) => ({
				full_name: repo,
				owner: { login: "lev" },
				permissions: { admin: true, push: true, pull: true },
				pushed_at: "2026-08-18T12:00:00.000Z",
			})),
		);
	}
	const issues = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
	);
	if (issues?.[1] !== undefined) {
		return json([
			{
				number: 1,
				title: "Ticket 1",
				state: "open",
				state_reason: null,
				html_url: `https://github.com/${issues[1]}/issues/1`,
				updated_at: "2026-08-18T12:00:00.000Z",
			},
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?")
	) {
		return json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const emptyPage = {
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		};
		return json({
			data: {
				viewer: {
					login: "lev",
					projectsV2: emptyPage,
					organizations: emptyPage,
				},
				node: { fields: { nodes: [{}] } },
			},
		});
	}
	if (url === "https://api.linear.app/graphql") {
		return json({
			data: {
				viewer: { id: "lev" },
				projects: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	return unrecorded(input);
};

await rm(data, { recursive: true, force: true });
await mkdir(data, { recursive: true });
const configPath = join(data, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({ tracked: [], checkoutRoots: [], pollIntervalSeconds: 3600 }, null, "\t")}\n`,
);

let upstream: URL | null = null;

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
void (async () => {
	const deadline = Date.now() + 9_000;
	while (upstream === null && Date.now() < deadline) {
		if (appBase !== "") {
			const loaded = await fetch(new URL("/api/overview", appBase)).catch(
				() => null,
			);
			if (loaded?.ok) {
				const body = (await loaded.json()) as { polling?: boolean };
				if (body.polling !== true) {
					upstream = new URL(appBase);
					return;
				}
			}
		}
		await Bun.sleep(50);
	}
})();

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "0"],
	{
		env: {
			...process.env,
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: data,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(data, "project-flow.sqlite"),
		stdout: (line) => {
			appBase = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: new Promise((resolve) => {
			const stop = () => {
				gate.stop(true);
				void rm(data, { recursive: true, force: true }).finally(() =>
					resolve(),
				);
			};
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}),
	},
);
process.exit(result.exitCode);
