import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const port = process.argv[2] ?? "4176";
const rootDir = process.argv[3] ?? "/var/tmp";
const holdAsk = process.argv[4] === "hold";
const ask = "<!-- workcell:ask pf-1 -->";
const headline = "Which bot should review this?";

let releaseAsk = false;

function recordedIssues(): Response {
	return Response.json({
		data: {
			issues: {
				nodes: releaseAsk
					? [
							{
								id: "PF-1",
								identifier: "PF-1",
								title: "Open ask",
								description: "",
								state: { type: "unstarted" },
								updatedAt: "2026-08-18T13:00:00.000Z",
								parent: null,
								projectMilestone: null,
								labels: { nodes: [] },
								assignee: null,
								attachments: { nodes: [] },
								comments: {
									nodes: [
										{
											id: "comment-1",
											body: `${headline}\n\n${ask}`,
											createdAt: "2026-08-18T13:00:00.000Z",
											user: { name: "Ada", displayName: "Ada" },
											reactions: [],
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								inverseRelations: { nodes: [] },
							},
						]
					: [],
				pageInfo: { hasNextPage: false, endCursor: null },
			},
		},
	});
}

const recorded: Fetch = async (input, init) => {
	const url = String(input instanceof Request ? input.url : input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.linear.app/graphql") {
		if (body.includes("MemberProjects") || body.includes("viewer { id }")) {
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
		if (body.includes("ProjectByPin")) {
			return Response.json({
				data: {
					projects: {
						nodes: [
							{
								id: "project-flow",
								name: "Project Flow",
								slugId: "project-flow",
							},
						],
					},
				},
			});
		}
		if (body.includes("ProjectIssues")) {
			return recordedIssues();
		}
	}
	return new Response("not recorded", { status: 404 });
};

const root = await mkdtemp(join(rootDir, "project-flow-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [{ tracker: "linear", project: "project-flow" }],
		checkoutRoots: [],
		pollIntervalSeconds: 3600,
	}),
);

const built = await Bun.build({
	entrypoints: [join(import.meta.dir, "notification-stub.ts")],
	target: "browser",
});
const stubSource = await built.outputs[0]?.text();
if (stubSource === undefined) {
	throw new Error("notification stub did not build");
}
const originalFetch = globalThis.fetch.bind(globalThis);
let upstreamOrigin = "";

await run(["--config", config, "--host", "127.0.0.1", "--port", "0"], {
	env: {
		LINEAR_API_KEY: "recorded-linear-key",
		XDG_DATA_HOME: root,
	},
	fetch: recorded,
	readGhToken: async () => null,
	databasePath: join(root, "store.sqlite"),
	now: () => new Date("2026-10-18T12:00:00.000Z"),
	stdout: (line) => {
		upstreamOrigin = new URL(line).origin;
		startProxy();
		if (holdAsk) {
			return;
		}
		const origin = upstreamOrigin;
		const arm = async () => {
			const stream = await originalFetch(
				new URL("/api/proof/stream-open", origin),
			);
			const permission = await originalFetch(
				new URL("/api/proof/permission", origin),
			);
			if (!stream.ok || !permission.ok) {
				setTimeout(() => {
					void arm();
				}, 200);
				return;
			}
			releaseAsk = true;
			await originalFetch(new URL("/api/refresh", origin), { method: "POST" });
		};
		setTimeout(() => {
			void arm();
		}, 200);
	},
	waitForStop: new Promise(() => {}),
});

function startProxy(): void {
	const proxy = Bun.serve({
		hostname: "127.0.0.1",
		port: Number(port),
		async fetch(request) {
			const url = new URL(request.url);
			const upstream = new URL(url.pathname + url.search, upstreamOrigin);
			const init: RequestInit = {
				method: request.method,
				headers: request.headers,
			};
			if (request.method !== "GET" && request.method !== "HEAD") {
				init.body = request.body;
			}
			const response = await originalFetch(upstream, init);
			const type = response.headers.get("content-type") ?? "";
			if (
				!type.includes("text/html") ||
				url.searchParams.get("proof") !== "notification"
			) {
				return response;
			}
			const html = await response.text();
			const withStub = html.includes("<head>")
				? html.replace("<head>", `<head><script>${stubSource}</script>`)
				: `<script>${stubSource}</script>${html}`;
			return new Response(withStub, {
				status: response.status,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
	console.log(proxy.url.href);
}
