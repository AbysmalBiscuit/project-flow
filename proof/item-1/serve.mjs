import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/main.ts";

const projectId = "PVT_kwDOFound";
const projectTitle = "Widget board";

function recorded(input, init) {
	const url = typeof input === "string" ? input : input.url;
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return Response.json([]);
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("OrgProjects")
	) {
		return Response.json({
			data: {
				organization: {
					projectsV2: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	if (url === "https://api.github.com/graphql" && body.includes("node(id:")) {
		return Response.json({
			data: {
				node: {
					items: {
						nodes: [
							{
								content: {
									__typename: "Issue",
									number: 9,
									state: "OPEN",
									stateReason: null,
									repository: { nameWithOwner: "AbysmalBiscuit/project-flow" },
								},
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("ViewerProjects")
	) {
		return Response.json({
			data: {
				viewer: {
					login: "lev",
					projectsV2: {
						nodes: [
							{
								id: projectId,
								number: 3,
								owner: { login: "AbysmalBiscuit" },
								title: projectTitle,
								closed: false,
								updatedAt: "2026-10-18T12:00:00Z",
							},
						],
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
await writeFile(configPath, "{}\n");
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
