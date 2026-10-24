import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import {
	recordedDiscovery,
	repoReadFromHandler,
	urlOf,
} from "../test/support.ts";
import { proofStops } from "./lifetime.ts";
import { unrecorded } from "./recorded.ts";

const repo = "acme/flow";
const port = Number(process.argv[2] ?? "4808");
const mode = process.argv[3] ?? "refresh";
const pollLagMs = 25_000;
const ageMs = new Map([
	["seconds", 10_000],
	["minutes", 5 * 60_000],
	["hours", 2 * 60 * 60_000],
]);
let ageOffset = ageMs.get(mode) ?? 10_000;
let anchorAt = Date.now();
let polls = 0;
let releaseRefresh = () => {};
let refreshHold = Promise.resolve();
let holdProjectReads = false;

function holdRefresh(): void {
	refreshHold = new Promise((resolve) => {
		releaseRefresh = () => {
			releaseRefresh = () => {};
			resolve();
		};
	});
}

function issue(): Record<string, unknown> {
	return {
		number: 1,
		title: "Stored ticket",
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/1`,
		updated_at: "2026-08-01T12:00:00.000Z",
		body: "",
		labels: [],
		assignee: null,
	};
}

function githubRest(url: string): Response | null {
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return Response.json([issue()], { headers: { link: "" } });
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
	return null;
}

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const rest = githubRest(url);
	if (rest !== null) {
		return rest;
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("query RepoRead")) {
			polls += 1;
			if (polls > 1) {
				await refreshHold;
			}
		}
		const read = await repoReadFromHandler(input, init, recorded);
		if (read !== null) {
			return read;
		}
		return Response.json({
			data: {
				repository: {
					nameWithOwner: repo,
					autoMergeAllowed: false,
					issue: { closedByPullRequestsReferences: { nodes: [] } },
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

const dir = await mkdtemp(join(tmpdir(), "project-flow-288-"));
process.env.XDG_DATA_HOME = dir;
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		theme: "light",
		tracked: [{ tracker: "github", repo }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
		pollIntervalSeconds: 86_400,
	})}\n`,
);

if (mode === "refresh") {
	holdRefresh();
}

const running = await start({
	configPath,
	token: "recorded-token",
	linearKey: "recorded-linear-key",
	fetch: answerRecordedRepoRead(recorded),
	databasePath: join(dir, "project-flow.sqlite"),
	hostname: "127.0.0.1",
	port: 0,
	now: () => new Date(anchorAt + pollLagMs - ageOffset),
	listTodos: async () => "",
	listCheckouts: async () => [],
});

const appRequests: string[] = [];

function proofRequests(request: Request): Response {
	if (request.method === "DELETE") {
		appRequests.length = 0;
		return new Response(null, { status: 204 });
	}
	const lines = appRequests.map((line) => `<li>${line}</li>`).join("");
	return new Response(
		`<!doctype html><title>requests</title><p id="proof-requests">${appRequests.join(", ")}</p><ul>${lines}</ul>`,
		{ headers: { "content-type": "text/html; charset=utf-8" } },
	);
}

const gate = Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/proof/requests") {
			return proofRequests(request);
		}
		if (url.pathname === "/proof/release") {
			anchorAt = Date.now();
			releaseRefresh();
			await fetch(new URL("/api/refresh", running.url), { method: "POST" });
			return new Response("released", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		if (url.pathname === "/proof/hold") {
			holdRefresh();
			holdProjectReads = true;
			const script = `<script>fetch("/proof/hold-set",{method:"POST"}).then(()=>document.body.dataset.held="1")</script>`;
			return new Response(
				`<!doctype html><title>held</title><p id="proof-hold">held</p>${script}`,
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			);
		}
		if (url.pathname === "/proof/hold-set" && request.method === "POST") {
			holdRefresh();
			holdProjectReads = true;
			return new Response("held", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		if (
			holdProjectReads &&
			request.method === "GET" &&
			url.pathname.startsWith("/api/projects/")
		) {
			await refreshHold;
		}
		if (url.pathname === "/proof/age") {
			const name = url.searchParams.get("age") ?? "";
			const next = ageMs.get(name);
			if (next === undefined) {
				return new Response("unknown age", { status: 400 });
			}
			ageOffset = next;
			anchorAt = Date.now();
			await fetch(new URL("/api/refresh", running.url), { method: "POST" });
			return new Response(
				`<!doctype html><title>aged</title><p id="proof-age">${name}</p>`,
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			);
		}
		if (url.pathname.startsWith("/api/")) {
			appRequests.push(`${request.method} ${url.pathname}`);
		}
		const target = new URL(url.pathname + url.search, running.url);
		const headers = new Headers(request.headers);
		headers.delete("host");
		const hasBody = request.method !== "GET" && request.method !== "HEAD";
		const upstream = await fetch(target, {
			method: request.method,
			headers,
			...(hasBody ? { body: request.body } : {}),
		});
		if (request.method === "GET" && url.pathname.startsWith("/projects/")) {
			const html = await upstream.text();
			const pollAt = anchorAt + pollLagMs - ageOffset;
			const clock =
				`<script>` +
				`(function(){` +
				`var offset=0;` +
				`var NativeDate=Date;` +
				`var now=NativeDate.now;` +
				`NativeDate.now=function(){return now.call(NativeDate)+offset};` +
				`function WrappedDate(){` +
				`if(arguments.length===0){return new NativeDate(NativeDate.now())}` +
				`return new NativeDate(...arguments)` +
				`}` +
				`WrappedDate.prototype=NativeDate.prototype;` +
				`WrappedDate.now=NativeDate.now;` +
				`WrappedDate.parse=NativeDate.parse;` +
				`WrappedDate.UTC=NativeDate.UTC;` +
				`globalThis.Date=WrappedDate;` +
				`globalThis.__projectFlowProofAddOffset=function(ms){offset+=ms};` +
				`})();` +
				`</script>`;
			const stamp =
				`<script type="module">` +
				`var queries=await import("/src/queries.ts");` +
				`var name=decodeURIComponent(location.pathname.slice("/projects/".length));` +
				`var key=queries.pageQuery.project(name).queryKey;` +
				`var deadline=Date.now()+8000;` +
				`while(queries.pageQueryClient.getQueryData(key)===undefined&&Date.now()<deadline){` +
				`await new Promise(function(resolve){setTimeout(resolve,20)});` +
				`}` +
				`var data=queries.pageQueryClient.getQueryData(key);` +
				`if(data!==undefined){queries.pageQueryClient.setQueryData(key,data,{updatedAt:${pollAt}})}` +
				`</script>`;
			const withClock = html.includes("</head>")
				? html.replace("</head>", `${clock}</head>`)
				: `${clock}${html}`;
			const arm =
				`<button type="button" hidden id="proof-arm-hold">Arm hold</button>` +
				`<script>document.getElementById("proof-arm-hold").addEventListener("click",()=>{fetch("/proof/hold-set",{method:"POST"}).then(()=>{document.getElementById("proof-arm-hold").textContent="held"})})</script>` +
				`<button type="button" id="proof-add-minutes">Add 5 min</button>` +
				`<button type="button" id="proof-add-hours">Add 2 h</button>` +
				`<script>` +
				`document.getElementById("proof-add-minutes").addEventListener("click",()=>globalThis.__projectFlowProofAddOffset(${5 * 60_000}));` +
				`document.getElementById("proof-add-hours").addEventListener("click",()=>globalThis.__projectFlowProofAddOffset(${2 * 60 * 60_000}));` +
				`</script>`;
			const marked = withClock.includes("</body>")
				? withClock.replace("</body>", `${stamp}${arm}</body>`)
				: `${withClock}${stamp}${arm}`;
			const pageHeaders = new Headers(upstream.headers);
			pageHeaders.delete("content-length");
			return new Response(marked, {
				status: upstream.status,
				headers: pageHeaders,
			});
		}
		return upstream;
	},
});

console.log(gate.url.href);
await proofStops();
await running.stop();
