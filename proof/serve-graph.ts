import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, urlOf } from "../test/support.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-110-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const widget = "acme/widget";
const platform = "acme/platform";
const port = 4190;

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: platform },
			{ tracker: "linear", project: "gate" },
		],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
		viewerLogins: ["lev"],
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
		return page([
			{
				id: 70,
				body: "The gate note is ready.",
				user: { login: "lev" },
				html_url: `${url}#issuecomment-70`,
				created_at: "2026-08-18T12:00:00Z",
			},
		]);
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

let base = "";
const stop = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});

try {
	await run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: { GITHUB_TOKEN: "recorded-token" },
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
		stdout: (line) => {
			base = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: (async () => {
			const deadline = Date.now() + 15_000;
			while (Date.now() < deadline) {
				if (base !== "") {
					const loaded = await fetch(
						new URL(`/api/projects/${encodeURIComponent(widget)}`, base),
					).catch(() => null);
					if (loaded?.ok) {
						const body = (await loaded.json()) as {
							tickets?: {
								key?: string;
								outsideBlockers?: { key?: string; title?: string }[];
							}[];
						};
						const outside = body.tickets?.some((ticket) =>
							ticket.outsideBlockers?.some(
								(blocker) => blocker.key === "acme/platform#9",
							),
						);
						if (outside) {
							const internal = new URL(base);
							Bun.serve({
								hostname: "127.0.0.1",
								port,
								fetch(request) {
									const url = new URL(request.url);
									url.protocol = internal.protocol;
									url.hostname = internal.hostname;
									url.port = internal.port;
									return fetch(
										new Request(url, {
											method: request.method,
											headers: request.headers,
											body: request.body,
										}),
									);
								},
							});
							console.log(`http://127.0.0.1:${port}/`);
							await stop;
							return;
						}
					}
				}
				await new Promise((pause) => setTimeout(pause, 50));
			}
			throw new Error("project load returned no outside ticket");
		})(),
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
