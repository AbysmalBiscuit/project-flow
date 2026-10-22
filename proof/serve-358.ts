import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";
import { proofStops, proofTheme } from "./lifetime.ts";
import { recordedIssues } from "./recorded.ts";

// A cold poll reads acme/widget, fails on acme/broken and stays on acme/slow.
// The proxy holds each project read, so the page waits for its report.
const port = Number(process.argv[2] ?? "4358");
const projectReadDelayMs = 6_000;
const root = await mkdtemp(join(tmpdir(), "project-flow-358-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		theme: "light",
		tracked: [
			{ tracker: "github", repo: "acme/widget" },
			{ tracker: "github", repo: "acme/broken" },
			{ tracker: "github", repo: "acme/slow" },
		],
		pollIntervalSeconds: 3600,
	}),
);

const issue = (number: number, title: string, state = "open") => ({
	number,
	title,
	state,
	state_reason: state === "closed" ? "completed" : null,
	updated_at: "2026-10-20T00:00:00Z",
	html_url: `https://github.com/acme/widget/issues/${number}`,
});

function held(init: RequestInit | undefined): Promise<Response> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(Response.json([])), 600_000);
		init?.signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(new Error("stopped"));
		});
	});
}

const widget = recordedIssues({
	"acme/widget": [
		issue(1, "Ship the board", "closed"),
		issue(2, "Draft the page"),
		issue(3, "Hold the launch"),
	],
});

const recorded: Fetch = (input, init) => {
	const body = typeof init?.body === "string" ? init.body : "";
	if (body.includes("query RepoRead") && body.includes('"name":"broken"')) {
		return Promise.resolve(new Response("recorded failure", { status: 500 }));
	}
	if (body.includes("query RepoRead") && body.includes('"name":"slow"')) {
		return held(init);
	}
	return widget(input, init);
};

const running = await start({
	configPath,
	token: "recorded-token",
	linearKey: null,
	fetch: recorded,
	databasePath: join(root, "project-flow.sqlite"),
	hostname: "127.0.0.1",
	port: port + 1,
});
Bun.serve({
	hostname: "127.0.0.1",
	port,
	idleTimeout: 0,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/projects/")) {
			await Bun.sleep(projectReadDelayMs);
		}
		const response = await fetch(
			new Request(new URL(`${url.pathname}${url.search}`, running.url), {
				method: request.method,
				headers: request.headers,
				body: request.body,
			}),
		);
		return proofTheme(response);
	},
});
console.log(`http://127.0.0.1:${port}/`);
await proofStops();
process.exit(0);
