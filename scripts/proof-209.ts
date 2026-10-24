import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { proofStops } from "../proof/lifetime.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-209-proof-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		theme: "light",
		overview: {
			filter: "all",
			sort: "project",
			direction: "asc",
			view: "cards",
		},
		pinned: [{ tracker: "github", repo: "AbysmalBiscuit/factory" }],
		checkoutRoots: [],
		viewerLogins: ["lev"],
	})}\n`,
);

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const issue = {
	number: 407,
	title: "Lev answers on the factory handoff before the next run starts",
	state: "open",
	state_reason: null,
	html_url: "https://github.com/AbysmalBiscuit/factory/issues/407",
	updated_at: "2026-08-01T12:00:00.000Z",
	body: "",
	labels: [{ name: "needs-human" }],
	assignee: { login: "lev" },
};

const recorded: Fetch = async (input) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	if (url === "https://api.github.com/user") {
		return json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return json([]);
	}
	if (url === "https://api.github.com/graphql") {
		return json({
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
					issue: { closedByPullRequestsReferences: { nodes: [] } },
				},
			},
		});
	}
	if (
		url.startsWith(
			"https://api.github.com/repos/AbysmalBiscuit/factory/issues?",
		)
	) {
		return json([issue]);
	}
	if (
		url === "https://api.github.com/repos/AbysmalBiscuit/factory/issues/407"
	) {
		return json(issue);
	}
	if (url === "https://api.github.com/repos/AbysmalBiscuit/factory") {
		return json({
			full_name: "AbysmalBiscuit/factory",
			private: false,
			owner: { login: "AbysmalBiscuit" },
		});
	}
	if (url === "https://api.linear.app/graphql") {
		return json({
			data: {
				viewer: { id: "lev" },
				projects: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	if (url.includes("/labels?")) {
		return json([{ name: "needs-human", color: "d73a4a" }]);
	}
	if (
		url.includes("/pulls") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/branches") ||
		url.includes("/reactions") ||
		url.includes("/commits/")
	) {
		return json([]);
	}
	return new Response("not recorded", { status: 404 });
};

const portFlag = process.argv.indexOf("--port");
const portArg = portFlag === -1 ? undefined : process.argv[portFlag + 1];
const port = portArg ?? "4765";

try {
	const result = await run(["--config", configPath, "--port", port], {
		env: {
			...process.env,
			XDG_DATA_HOME: root,
			GITHUB_TOKEN: "recorded-token",
		},
		fetch: recorded,
		readGhToken: async () => null,
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-02T12:00:00.000Z"),
		listTodos: async () => "",
		listCheckouts: async () => [],
		stdout: (line) => {
			console.log(line);
		},
		stderr: (line) => {
			console.error(line);
		},
		waitForStop: proofStops(),
	});
	process.exitCode = result.exitCode;
} finally {
	await rm(root, { recursive: true, force: true });
}
