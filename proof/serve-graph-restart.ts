import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, urlOf } from "../test/support.ts";

const port = Number(process.argv[2] ?? "4192");
const controlPort = port + 1;
const root = await mkdtemp(join("/var/tmp", "project-flow-110-restart-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const widget = "acme/widget";
const platform = "acme/platform";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: platform },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		viewerLogins: ["lev"],
		projectViews: {
			[widget]: { openView: "graph" },
		},
	}),
);

function issue(
	repo: string,
	number: number,
	title: string,
	body = "",
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
		body,
	};
}

const widgetIssues = [
	issue(widget, 2, "Draw the nodes", `Blocked by: ${platform}#9`),
	issue(widget, 4, "Read the review"),
];
const platformIssues = [issue(platform, 9, "Platform gate")];

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	if (url.includes(`/repos/${widget}/issues?`)) {
		return page(widgetIssues);
	}
	if (url.includes(`/repos/${platform}/issues?`)) {
		return page(platformIssues);
	}
	const issueUrl = url.match(
		/https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/,
	);
	if (issueUrl?.[1] !== undefined && issueUrl[2] !== undefined) {
		const found = [...widgetIssues, ...platformIssues].find(
			(item) =>
				item.number === Number(issueUrl[2]) &&
				String(item.html_url).includes(issueUrl[1] ?? ""),
		);
		if (found === undefined) {
			return new Response("not recorded", { status: 404 });
		}
		return Response.json(found);
	}
	if (url.endsWith("/comments") && url.includes("/issues/")) {
		return page([]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		/\/pulls\/\d+$/.test(url)
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (url === "https://api.linear.app/graphql") {
		return Response.json({
			data: { viewer: { id: "lev" }, projects: emptyPage },
		});
	}
	return new Response("not recorded", { status: 404 });
};

type Running = { stop: () => void; done: Promise<void> };
let app: Running | null = null;

function startApp(): void {
	let release: () => void = () => {};
	const stopped = new Promise<void>((resolve) => {
		release = resolve;
	});
	const done = run(
		["--config", configPath, "--host", "127.0.0.1", "--port", String(port)],
		{
			env: { ...process.env, GITHUB_TOKEN: "recorded-token" },
			fetch: recorded,
			readGhToken: async () => null,
			listTodos: async () => "",
			listCheckouts: async () => [],
			databasePath: join(root, "project-flow.sqlite"),
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			stderr: (line) => console.error(line),
			waitForStop: stopped,
		},
	).then(() => undefined);
	app = { stop: release, done };
}

async function waitUntilReady(): Promise<boolean> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const ready = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
		if (ready?.ok) {
			return true;
		}
		await new Promise((pause) => setTimeout(pause, 50));
	}
	return false;
}

const control = `<!doctype html>
<meta charset="utf-8">
<title>Graph proof control</title>
<p id="proof-status">ready</p>
<button type="button" id="proof-stop">Stop the server</button>
<button type="button" id="proof-start">Start a new server</button>
<script>
	const status = document.querySelector("#proof-status");
	async function call(path, label) {
		status.textContent = label;
		const response = await fetch(path, { method: "POST" });
		status.textContent = await response.text();
	}
	document.querySelector("#proof-stop").addEventListener("click", () => {
		call("/stop", "stopping");
	});
	document.querySelector("#proof-start").addEventListener("click", () => {
		call("/start", "starting");
	});
</script>
`;

Bun.serve({
	hostname: "127.0.0.1",
	port: controlPort,
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/") {
			return new Response(control, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		if (request.method === "POST" && url.pathname === "/stop") {
			const running = app;
			app = null;
			if (running !== null) {
				running.stop();
				await running.done;
			}
			return new Response("stopped");
		}
		if (request.method === "POST" && url.pathname === "/start") {
			if (app !== null) {
				return new Response("already running", { status: 409 });
			}
			startApp();
			if (await waitUntilReady()) {
				return new Response("started");
			}
			return new Response("start failed", { status: 500 });
		}
		return new Response("not found", { status: 404 });
	},
});

const halt = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});

async function stopOpened(running: Running | null): Promise<void> {
	if (running === null) {
		return;
	}
	running.stop();
	await running.done;
}

let opened: Running | null = null;
try {
	startApp();
	opened = app;
	if (!(await waitUntilReady())) {
		throw new Error("graph server did not answer");
	}
	console.log(`http://127.0.0.1:${controlPort}/`);
	await halt;
} finally {
	await stopOpened(opened);
	await rm(root, { recursive: true, force: true });
}
