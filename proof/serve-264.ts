import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/main.ts";
import {
	recordedDiscovery,
	repoReadFromHandler,
	urlOf,
} from "../test/support.ts";
import { proofStops } from "./lifetime.ts";
import { unrecorded } from "./recorded.ts";

const repo = "acme/flow";
const port = process.argv[2] ?? "4799";
let polls = 0;
let releaseNext = () => {};
let nextPoll = Promise.resolve();

function holdNextPoll(): void {
	nextPoll = new Promise((resolve) => {
		releaseNext = () => {
			releaseNext = () => {};
			resolve();
		};
	});
}

const recorded = async (input: string | URL | Request, init?: RequestInit) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		const stored = polls <= 1;
		return Response.json(
			[
				{
					number: 1,
					title: stored ? "Stored ticket" : "Polled ticket title",
					state: stored ? "open" : "closed",
					state_reason: stored ? null : "completed",
					html_url: `https://github.com/${repo}/issues/1`,
					updated_at: "2026-08-01T12:00:00.000Z",
					body: "",
					labels: [],
					assignee: null,
				},
			],
			{ headers: { link: "" } },
		);
	}
	if (url.includes("/labels?")) {
		return Response.json([
			{ name: "ready", color: "ededed" },
			{ name: "factory: running", color: "fbca04" },
			{ name: "factory: in-review", color: "0e8a16" },
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/dependencies/")
	) {
		return Response.json([]);
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("query RepoRead")) {
			polls += 1;
			if (polls === 1) {
				holdNextPoll();
			} else {
				await nextPoll;
			}
			const read = await repoReadFromHandler(input, init, recorded);
			if (read !== null) {
				return read;
			}
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
					issue: { closedByPullRequestsReferences: { nodes: [] } },
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
		});
	}
	if (url === "https://api.linear.app/graphql") {
		return Response.json({
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

const dir = await mkdtemp(join("/var/tmp", "project-flow-264-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		theme: "light",
		tracked: [{ tracker: "github", repo }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 3600,
	})}\n`,
);

let upstream: URL | null = null;
const pageRequests: string[] = [];

function upstreamUrl(request: Request, target: URL): URL {
	const url = new URL(request.url);
	url.protocol = target.protocol;
	url.hostname = target.hostname;
	url.port = target.port;
	return url;
}

const gate = Bun.serve({
	hostname: "127.0.0.1",
	port: Number(port),
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/proof/requests") {
			if (
				request.method === "DELETE" ||
				url.searchParams.get("clear") === "1"
			) {
				pageRequests.length = 0;
			}
			if (request.method === "DELETE") {
				return new Response(null, { status: 204 });
			}
			const overview = pageRequests.filter(
				(line) => line === "GET /api/overview",
			).length;
			const lines = pageRequests.map((line) => `<li>${line}</li>`).join("");
			return new Response(
				`<!doctype html><title>requests</title><p id="proof-overview-fetches">overview fetches ${overview}</p><ul>${lines}</ul>`,
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			);
		}
		const target = upstream;
		if (target === null) {
			return new Promise(() => {});
		}
		if (url.pathname.startsWith("/api/")) {
			pageRequests.push(`${request.method} ${url.pathname}`);
		}
		if (url.pathname === "/api/refresh" && request.method === "POST") {
			setTimeout(releaseNext, 400);
		}
		const next = upstreamUrl(request, target);
		const headers = new Headers(request.headers);
		headers.delete("host");
		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		return fetch(next, {
			method: request.method,
			headers,
			...(hasBody ? { body: request.body } : {}),
		});
	},
});

holdNextPoll();
console.log(gate.url.href);

const heard = new Promise<string>((resolve, reject) => {
	const timer = setTimeout(() => {
		reject(new Error("recorded app did not listen"));
	}, 15_000);
	void run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: {
			...process.env,
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: dir,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		waitForStop: proofStops(),
		stdout: (line) => {
			console.error(`app ${line}`);
			const match = line.match(/http:\/\/127\.0\.0\.1:\d+\//);
			if (match !== null) {
				clearTimeout(timer);
				resolve(match[0]);
			}
		},
		stderr: (line) => console.error(line),
	}).then((result) => {
		clearTimeout(timer);
		reject(new Error(`recorded app exited ${result.exitCode}`));
	});
});

upstream = new URL(await heard);
await new Promise(() => {});
