import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofStops } from "../proof/lifetime.ts";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	emptyProjectFields,
	recordedViewer,
	trackerRequest,
	unrecorded,
} from "./support.ts";

const port = process.argv.find((arg) => arg.startsWith("--port="))?.slice(7);
if (port === undefined || !/^\d+$/.test(port)) {
	console.error("usage: bun test/proof-server.ts --port=N");
	process.exit(1);
}
if (process.argv.some((arg) => arg.startsWith("--data="))) {
	console.error("proof server owns its data directory; do not pass --data");
	process.exit(1);
}

const fixtureDir = join(import.meta.dir, "fixtures");

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

async function fixture(name: string): Promise<unknown> {
	return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

function recordedResponse(name: string): Promise<Response> {
	return readFile(join(fixtureDir, name)).then(
		(body) =>
			new Response(body, {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	);
}

const recordedRepoPages: { marker: string; file: string }[] = [
	{
		marker: "/pulls?state=open&per_page=100&page=1",
		file: "github-open-pulls.json",
	},
	{ marker: "/branches?per_page=100&page=1", file: "github-branches.json" },
	{
		marker: "/issues/205/comments?",
		file: "github-issue-comments-205.json",
	},
	{
		marker:
			"/commits/7a8bb0edabc992ca7ede4918c8ea4f892ca5aa5c/check-runs?per_page=100",
		file: "github-check-runs-206.json",
	},
	{
		marker:
			"/commits/1fde7978b6c0fb12c83d5c5dd47c7ee76224c9ce/check-runs?per_page=100",
		file: "github-check-runs-22.json",
	},
	{
		marker: "/pulls/206/reviews?per_page=100&page=1",
		file: "github-pull-reviews-206.json",
	},
	{
		marker: "/pulls/22/reviews?per_page=100&page=1",
		file: "github-pull-reviews-22.json",
	},
	{
		marker: "/issues/206/comments?per_page=100&page=1",
		file: "github-pull-comments-206.json",
	},
	{
		marker: "/issues/22/comments?per_page=100&page=1",
		file: "github-pull-comments-22.json",
	},
	{
		marker: "/issues/206/reactions?per_page=100&page=1",
		file: "github-pull-reactions-206.json",
	},
	{
		marker: "/issues/22/reactions?per_page=100&page=1",
		file: "github-pull-reactions-22.json",
	},
];

function recordedRepoPage(
	repo: string | undefined,
	url: string,
): string | null {
	if (repo !== "AbysmalBiscuit/project-flow") {
		return null;
	}
	return (
		recordedRepoPages.find((page) => url.includes(page.marker))?.file ?? null
	);
}

const recorded: Fetch = async (input, init) => {
	const request = trackerRequest(input, init);
	const url = request.url;
	if (url.startsWith("https://api.github.com/user/repos")) {
		return recordedResponse("github-repo.json").then((page) =>
			page.json().then((repo: unknown) => json([repo])),
		);
	}
	const known = recordedViewer(input, init) ?? emptyProjectFields(input, init);
	if (known !== null) {
		return known;
	}
	const repo = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\//,
	)?.[1];
	const recordedPage = recordedRepoPage(repo, url);
	if (recordedPage !== null) {
		return recordedResponse(recordedPage);
	}
	if (repo !== undefined && url.includes("/issues?")) {
		const issues = (await fixture("github-issues.json")) as {
			html_url?: string;
		}[];
		return json(
			issues.filter((issue) => issue.html_url?.includes(`/${repo}/`)),
		);
	}
	if (repo !== undefined && url.includes("/labels?")) {
		return recordedResponse("github-factory-labels.json");
	}
	if (
		url === "https://api.github.com/graphql" &&
		request.query.includes("ProjectFields")
	) {
		return recordedResponse("github-project-fields.json");
	}
	if (
		url === "https://api.linear.app/graphql" &&
		request.query.includes("TeamStates")
	) {
		return recordedResponse("linear-team-states.json");
	}
	if (
		url === "https://api.linear.app/graphql" &&
		request.query.includes("viewer")
	) {
		return recordedResponse("linear-viewer.json");
	}
	return unrecorded(input);
};

const stops = proofStops();

const data = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const configPath = join(data, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({ tracked: [], checkoutRoots: [], pollIntervalSeconds: 3600 }, null, "\t")}\n`,
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
			return recorded(input, init);
		},
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(data, "project-flow.sqlite"),
		stdout: (line) => {
			appBase = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: Promise.race([
			ready.then(() => new Promise<void>(() => {})),
			new Promise<void>((resolve) => {
				stopped.signal.addEventListener("abort", () => resolve(), {
					once: true,
				});
			}),
			stops.then(async () => {
				gate.stop(true);
				await rm(data, { recursive: true, force: true });
			}),
		]),
	},
);
process.exit(process.exitCode ?? result.exitCode);
