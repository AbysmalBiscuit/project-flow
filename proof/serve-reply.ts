import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { proofStops } from "./lifetime.ts";

const port = process.argv[2] ?? "4173";
const repo = "acme/widget";

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const url = String(input instanceof Request ? input.url : input);
	const method = init?.method ?? "GET";
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		return Response.json({
			data: {
				viewer: {
					login: "lev",
					projectsV2: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
					organizations: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
				repository: {
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
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([
			{
				number: 7,
				title: "Name the bot",
				state: "open",
				state_reason: null,
				updated_at: "2026-08-18T12:00:00.000Z",
				body: "Which bot should review this?",
				comments: 1,
				labels: [],
			},
		]);
	}
	if (
		url === `https://api.github.com/repos/${repo}/issues/7` &&
		method === "GET"
	) {
		return Response.json({
			number: 7,
			title: "Name the bot",
			html_url: `https://github.com/${repo}/issues/7`,
			state: "open",
		});
	}
	if (
		url.startsWith(`https://api.github.com/repos/${repo}/issues/7/comments`) &&
		method === "GET"
	) {
		return page([
			{
				id: 70,
				body: "Which bot should review this?",
				user: { login: "ada" },
				created_at: "2026-08-18T12:00:00.000Z",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-70`,
			},
		]);
	}
	if (
		url === `https://api.github.com/repos/${repo}/issues/7/comments` &&
		method === "POST"
	) {
		const posted = JSON.parse(body) as { body?: string };
		return Response.json(
			{
				id: 71,
				body: posted.body ?? "",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-71`,
				created_at: "2026-08-18T13:00:00.000Z",
				user: { login: "lev" },
			},
			{ status: 201 },
		);
	}
	if (url.includes("/pulls?") || url.includes("/branches?")) {
		return page([]);
	}
	return new Response("not recorded", { status: 404 });
};

const root = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
	}),
);
await run(["--config", config, "--host", "127.0.0.1", "--port", port], {
	env: {
		GITHUB_TOKEN: "recorded-token",
		LINEAR_API_KEY: "recorded-linear-key",
	},
	fetch: recorded,
	readGhToken: async () => null,
	databasePath: join(root, "store.sqlite"),
	stdout: (line) => {
		console.log(line);
	},
	waitForStop: proofStops(),
});
