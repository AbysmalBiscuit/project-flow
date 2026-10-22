import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	urlOf,
} from "../test/support.ts";
import { proofStops } from "./lifetime.ts";
import { emptyLinear, unrecorded } from "./recorded.ts";

const port = process.argv[2] ?? "0";
const mode = process.argv[3] ?? "filled";
const repo = "acme/widget";
const title = "Ship the board";
const postedBodies: string[] = [];
let holdThreadRead = false;

let holdSettingsRead = false;
let releaseHold: () => void = () => {};
const hold = new Promise<void>((resolve) => {
	releaseHold = resolve;
});
const holdReads = mode === "empty";
if (mode === "empty") {
	setTimeout(releaseHold, 20_000);
}

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function issue(): Record<string, unknown> {
	return {
		number: 7,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/7`,
		updated_at: "2026-10-18T12:00:00.000Z",
		body: "Which name should the board use?",
		comments: 1,
		labels: [],
	};
}

function emptyList(url: string): boolean {
	return (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
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
	const method = init?.method ?? "GET";
	const body = typeof init?.body === "string" ? init.body : "";
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
				repository: {
					issue: { closedByPullRequestsReferences: { nodes: [] } },
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
		});
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([issue()]);
	}
	if (
		url === `https://api.github.com/repos/${repo}/issues/7` &&
		method === "GET"
	) {
		return Response.json({
			number: 7,
			title,
			html_url: `https://github.com/${repo}/issues/7`,
			state: "open",
		});
	}
	if (
		url.startsWith(`https://api.github.com/repos/${repo}/issues/7/comments?`) &&
		method === "GET"
	) {
		return page([
			{
				id: 70,
				body: "Which name should the board use?",
				user: { login: "ada" },
				created_at: "2026-10-18T12:00:00.000Z",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-70`,
			},
			...postedBodies.map((text, index) => ({
				id: 71 + index,
				body: text,
				user: { login: "lev" },
				created_at: "2026-10-18T13:00:00.000Z",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-${71 + index}`,
			})),
		]);
	}
	if (
		url === `https://api.github.com/repos/${repo}/issues/7/comments` &&
		method === "POST"
	) {
		const posted = JSON.parse(body) as { body?: string };
		postedBodies.push(posted.body ?? "");
		return Response.json(
			{
				id: 71,
				body: posted.body ?? "",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-71`,
				created_at: "2026-10-18T13:00:00.000Z",
				user: { login: "lev" },
			},
			{ status: 201 },
		);
	}
	if (emptyList(url)) {
		return page([]);
	}
	return emptyLinear(url) ?? unrecorded(input);
}

const recorded: Fetch = async (input, init) => {
	if (holdReads) {
		await hold;
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	return recordedBody(input, init);
};

const dir = await mkdtemp(join("/var/tmp", "project-flow-265-"));
const configPath = join(dir, "config.json");
await writeFile(
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
				if (mode === "filled") {
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
				Bun.serve({
					hostname: "127.0.0.1",
					port: Number(port),
					async fetch(request) {
						const url = new URL(request.url);
						if (url.pathname === "/proof/hold-settings") {
							holdSettingsRead = true;
							return new Response("settings read held", {
								headers: { "content-type": "text/plain" },
							});
						}
						if (url.pathname === "/proof/hold-thread") {
							holdThreadRead = true;
							return new Response("thread read held", {
								headers: { "content-type": "text/plain" },
							});
						}
						const pageRead =
							request.method === "GET" &&
							(url.pathname.startsWith("/api/projects/") ||
								url.pathname === "/api/settings" ||
								url.pathname === "/api/overview" ||
								url.pathname.startsWith("/api/threads/"));
						if (mode === "filled" && pageRead) {
							await new Promise(() => {});
						}
						if (
							holdSettingsRead &&
							request.method === "GET" &&
							url.pathname === "/api/settings"
						) {
							await new Promise(() => {});
						}
						if (
							holdThreadRead &&
							request.method === "GET" &&
							url.pathname.startsWith("/api/threads/")
						) {
							await new Promise(() => {});
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
						return upstream;
					},
				});
				console.log(`http://127.0.0.1:${port}/`);
			})();
		},
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	},
);
process.exit(result.exitCode);
