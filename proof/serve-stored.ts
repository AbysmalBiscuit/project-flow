import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run, waitForStop } from "../src/main.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { emptyLinear, unrecorded } from "./recorded.ts";

const port = process.argv[2] ?? "0";
const mode = process.argv[3] ?? "filled";
const repo = "acme/widget";
const title = "Ship the board";

let releaseHold: () => void = () => {};
const hold = new Promise<void>((resolve) => {
	releaseHold = resolve;
});
let holdReads = mode === "empty";
let trackerEntered = false;
if (mode === "empty") {
	setTimeout(releaseHold, 20_000);
}

const firstPaint = [
	'<pre id="project-flow-first-paint" aria-hidden="true"></pre>',
	"<script>",
	"new MutationObserver(() => {",
	'const log = document.getElementById("project-flow-first-paint");',
	'const root = document.getElementById("root");',
	'if (log === null || root === null || log.textContent !== "") {',
	"return;",
	"}",
	'if (root.innerText.trim() === "") {',
	"return;",
	"}",
	'log.textContent = location.pathname + " " + root.innerText.replaceAll("\\n", " | ");',
	'}).observe(document.getElementById("root"), {',
	"childList: true,",
	"subtree: true,",
	"characterData: true,",
	"});",
	"</script>",
].join("\n");

function withFirstPaint(html: string): string {
	const marker = '<script type="module"';
	const at = html.indexOf(marker);
	if (at === -1) {
		return html;
	}
	return `${html.slice(0, at)}${firstPaint}${html.slice(at)}`;
}

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function issue(): Record<string, unknown> {
	return {
		number: 1,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/1`,
		updated_at: "2026-10-18T12:00:00.000Z",
	};
}

function emptyList(url: string): boolean {
	return (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/check-runs")
	);
}

function recordedBody(
	input: Parameters<Fetch>[0],
	init: Parameters<Fetch>[1],
): Response {
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url === "https://api.github.com/graphql") {
		const read = repoReadFromLists(input, init, { [repo]: [issue()] });
		if (read !== null) {
			return read;
		}
		return Response.json({
			data: {
				repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } },
			},
		});
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([issue()]);
	}
	if (emptyList(url)) {
		return page([]);
	}
	return emptyLinear(url) ?? unrecorded(input);
}

const recorded: Fetch = async (input, init) => {
	if (holdReads) {
		trackerEntered = true;
		await hold;
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	return recordedBody(input, init);
};

const dir = await mkdtemp(join(tmpdir(), "project-flow-263-"));
const configPath = join(dir, "config.json");
await Bun.write(
	configPath,
	`${JSON.stringify({
		theme: "light",
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
	})}\n`,
);

let appPort = 0;
const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "0"],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: dir,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () => new Date("2026-10-18T12:00:10.000Z"),
		stdout: (line) => {
			const base = line.trim();
			appPort = Number(new URL(base).port);
			void (async () => {
				if (mode === "empty") {
					const deadline = Date.now() + 9_000;
					while (!trackerEntered && Date.now() < deadline) {
						await Bun.sleep(20);
					}
				}
				if (mode === "filled" || mode === "hold") {
					const deadline = Date.now() + 9_000;
					while (Date.now() < deadline) {
						const response = await fetch(new URL("/api/overview", base)).catch(
							() => null,
						);
						if (response?.ok) {
							const body = (await response.json()) as {
								polling?: true;
								projects?: { pending?: true }[];
							};
							const stored = body.projects?.some(
								(project) => project.pending !== true,
							);
							if (stored === true && body.polling !== true) {
								break;
							}
						}
						await Bun.sleep(50);
					}
				}
				if (mode === "hold") {
					holdReads = true;
					await fetch(new URL("/api/refresh", base), { method: "POST" });
				}
				Bun.serve({
					hostname: "127.0.0.1",
					port: Number(port),
					async fetch(request) {
						const url = new URL(request.url);
						if (mode === "filled" && url.pathname.startsWith("/api/")) {
							await Bun.sleep(8_000);
						}
						const headers = new Headers(request.headers);
						headers.delete("host");
						const hasBody =
							request.method !== "GET" && request.method !== "HEAD";
						const upstream = await fetch(
							`http://127.0.0.1:${appPort}${url.pathname}${url.search}`,
							{
								method: request.method,
								headers,
								...(hasBody ? { body: request.body } : {}),
							},
						);
						const type = upstream.headers.get("content-type") ?? "";
						if (!type.includes("text/html")) {
							return upstream;
						}
						const html = withFirstPaint(await upstream.text());
						const next = new Headers(upstream.headers);
						next.delete("content-length");
						return new Response(html, {
							status: upstream.status,
							headers: next,
						});
					},
				});
				console.log(`http://127.0.0.1:${port}/`);
			})();
		},
		stderr: (line) => console.error(line),
		waitForStop: waitForStop(),
	},
);
process.exit(result.exitCode);
