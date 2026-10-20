import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, unrecorded, urlOf } from "./support.ts";

const repo = "acme/widget";

function flag(name: string): string | undefined {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	return found?.slice(prefix.length);
}

const port = flag("port");
const data = flag("data");
const openView = flag("open-view") ?? "board";
if (
	port === undefined ||
	!/^\d+$/.test(port) ||
	data === undefined ||
	data.trim() === "" ||
	(openView !== "board" && openView !== "table" && openView !== "graph")
) {
	console.error(
		"usage: bun test/fixture-server.ts --port=N --data=DIR [--open-view=board|table|graph]",
	);
	process.exit(1);
}

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

const issues = [
	issue(1, "Ship the map", {
		assignee: { login: "ada" },
		assignees: [{ login: "ada" }, { login: "bea" }],
	}),
	issue(2, "Draw the legend", {
		assignee: { login: "bea" },
		assignees: [{ login: "bea" }],
	}),
	issue(3, "Hold the copy", {
		assignee: { login: "cy" },
		assignees: [{ login: "cy" }],
	}),
	issue(4, "Recent done map", {
		state: "closed",
		state_reason: "completed",
		closed_at: "2026-08-17T12:00:00.000Z",
		assignee: { login: "ada" },
		assignees: [{ login: "ada" }],
		updated_at: "2026-08-17T12:00:00.000Z",
	}),
	issue(6, "Old done map", {
		state: "closed",
		state_reason: "completed",
		closed_at: "2026-08-10T12:00:00.000Z",
		assignee: { login: "ada" },
		assignees: [{ login: "ada" }],
		updated_at: "2026-08-10T12:00:00.000Z",
	}),
	issue(7, "Dropped map", {
		state: "closed",
		state_reason: "not_planned",
		assignee: { login: "ada" },
		assignees: [{ login: "ada" }],
	}),
];

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page(issues);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.endsWith("/comments")
	) {
		return page([]);
	}
	return unrecorded(input);
};

await rm(data, { recursive: true, force: true });
await mkdir(data, { recursive: true });
const configPath = join(data, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		projectViews: {
			[repo]: { openView, maxAgeDays: { Done: 30 } },
		},
	}),
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
			const loaded = await fetch(
				new URL(`/api/projects/${encodeURIComponent(repo)}`, appBase),
			).catch(() => null);
			if (loaded?.ok) {
				const body = (await loaded.json()) as {
					tickets?: { title?: string }[];
				};
				if (body.tickets?.some((ticket) => ticket.title === "Ship the map")) {
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
			XDG_DATA_HOME: data,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(data, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
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
