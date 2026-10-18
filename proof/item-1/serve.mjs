import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/main.ts";

const repo = "acme/found-widget";

function recorded(input, init) {
	const url = typeof input === "string" ? input : input.url;
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return Response.json([
			{
				full_name: repo,
				owner: { login: "lev" },
				permissions: { admin: true, push: true },
				pushed_at: "2026-10-18T12:00:00.000Z",
			},
		]);
	}
	if (url.includes("/issues?")) {
		return Response.json([
			{
				number: 4,
				title: "Show found projects",
				state: "open",
				state_reason: null,
				updated_at: "2026-10-18T12:00:00.000Z",
			},
		]);
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
			},
		});
	}
	if (url === "https://api.linear.app/graphql" && body.includes("projects(")) {
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
	if (url === "https://api.linear.app/graphql") {
		return Response.json({ data: { viewer: { id: "lev" } } });
	}
	return new Response("not recorded", { status: 404 });
}

const dir = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const configPath = join(dir, "config.json");
await writeFile(configPath, '{"pinned":[]}\n');
const databasePath = join(dir, "project-flow.sqlite");

const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", "4173"],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: recorded,
		readGhToken: async () => null,
		databasePath,
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: new Promise(() => {}),
	},
);
process.exit(result.exitCode);
