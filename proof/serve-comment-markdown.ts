import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, repoReadFromHandler, urlOf } from "../test/support.ts";
import { proofStops } from "./lifetime.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-comment-md-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const repo = "acme/widget";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [{ tracker: "github", repo }],
		pollIntervalSeconds: 3600,
	}),
);

const shaped = [
	"# Render note",
	"",
	"- one item",
	"- [ ] open task",
	"- [x] done task",
	"",
	"See the [spec](https://example.com/spec) and `ticket.key`.",
	"",
	"```ts",
	"const wide = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(8);",
	"```",
	"",
	"> quoted line",
	"",
	"| column | value |",
	"| --- | --- |",
	"| alpha | beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa |",
	"",
].join("\n");

const hostile = [
	"hostile note",
	"",
	"<script>window.__ran = true</script>",
	"",
	'<img src="x" onerror="window.__ran = true">',
	"",
	"See [trap](javascript:window.__ran=true) here.",
	"",
].join("\n");

const hidden = [
	"shown line",
	"<!-- workcell:ask 297-2 -->",
	"still shown",
].join("\n");

const wide = [
	"wide note",
	"",
	"```",
	"WIDECODE_abcdefghijklmnopqrstuvwxyz0123456789_abcdefghijklmnopqrstuvwxyz0123456789_END",
	"```",
	"",
	"| left | right |",
	"| --- | --- |",
	"| cell | WIDETABLE_abcdefghijklmnopqrstuvwxyz0123456789_abcdefghijklmnopqrstuvwxyz_END |",
	"",
].join("\n");

function issue(number: number, title: string): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
		body: "",
	};
}

const issues = [
	issue(1, "Shaped comment"),
	issue(2, "Hostile comment"),
	issue(3, "Hidden comment"),
	issue(4, "Wide comment"),
];

const bodies: Record<number, string> = {
	1: shaped,
	2: hostile,
	3: hidden,
	4: wide,
};

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		const read = await repoReadFromHandler(input, init, recorded);
		if (read !== null) {
			return read;
		}
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({
			data: {
				repository: {
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
	if (url.includes(`/repos/${repo}/issues?`)) {
		return page(issues);
	}
	const issueUrl = url.match(
		/https:\/\/api\.github\.com\/repos\/acme\/widget\/issues\/(\d+)$/,
	);
	if (issueUrl?.[1] !== undefined) {
		const found = issues.find((item) => item.number === Number(issueUrl[1]));
		if (found === undefined) {
			return new Response("not recorded", { status: 404 });
		}
		return Response.json(found);
	}
	const comments = url.match(
		/https:\/\/api\.github\.com\/repos\/acme\/widget\/issues\/(\d+)\/comments/,
	);
	if (comments?.[1] !== undefined) {
		const number = Number(comments[1]);
		const text = bodies[number];
		if (text === undefined) {
			return page([]);
		}
		return page([
			{
				id: 70 + number,
				body: text,
				user: { login: "ada" },
				html_url: `https://github.com/${repo}/issues/${number}#issuecomment-${70 + number}`,
				created_at: "2026-08-18T12:00:00Z",
			},
		]);
	}
	if (url.includes("/pulls/") && url.includes("/comments")) {
		return page([]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?")
	) {
		return page([]);
	}
	return new Response(`not recorded ${url}`, { status: 404 });
};

const portText = process.argv[2] ?? process.env.PORT ?? "4173";
if (!/^\d+$/.test(portText)) {
	console.error("invalid port: the port must be an integer");
	process.exit(1);
}
const port = Number(portText);

let base = "";
try {
	await run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
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
			const stops = proofStops();
			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				if (base !== "") {
					const loaded = await fetch(
						new URL(`/api/projects/${encodeURIComponent(repo)}`, base),
					).catch(() => null);
					if (loaded?.ok) {
						const project = (await loaded.json()) as {
							tickets?: { title?: string }[];
						};
						if (
							project.tickets?.some(
								(ticket) => ticket.title === "Shaped comment",
							)
						) {
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
							await stops;
							return;
						}
					}
				}
				await new Promise((pause) => setTimeout(pause, 50));
			}
			throw new Error("project load returned no shaped ticket");
		})(),
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
