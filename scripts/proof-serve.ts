import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-104-proof-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		pinned: [
			{ tracker: "github", repo: "acme/alpha" },
			{ tracker: "github", repo: "acme/beta" },
		],
		checkoutRoots: [],
		viewerLogins: ["lev"],
	})}\n`,
);

const stop = new Promise<void>((resolve) => {
	const done = () => resolve();
	process.once("SIGINT", done);
	process.once("SIGTERM", done);
});

function issue(
	repo: string,
	number: number,
	title: string,
	needsYou: boolean,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-08-01T12:00:00.000Z",
		body: "",
		labels: needsYou ? [{ name: "needs-human" }] : [],
		assignee: needsYou ? { login: "lev" } : null,
	};
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return json([]);
	}
	if (url === "https://api.github.com/graphql") {
		if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
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
				},
			});
		}
		return json({
			data: {
				repository: {
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
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
	const issues = url.match(
		/^https:\/\/api\.github\.com\/repos\/(acme\/(?:alpha|beta))\/issues\?/,
	);
	if (issues?.[1] === "acme/alpha") {
		return json([issue("acme/alpha", 1, "Alpha ticket", false)]);
	}
	if (issues?.[1] === "acme/beta") {
		return json([issue("acme/beta", 2, "Beta ticket", true)]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments")
	) {
		return json([]);
	}
	return new Response("not recorded", { status: 404 });
};

try {
	const result = await run(["--config", configPath, "--port", "4763"], {
		env: {
			...process.env,
			XDG_DATA_HOME: root,
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: recorded,
		readGhToken: async () => null,
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
		listTodos: async () => "",
		listCheckouts: async () => [],
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: stop,
	});
	if (result.exitCode !== 0) {
		process.exitCode = result.exitCode;
	}
} finally {
	await rm(root, { recursive: true, force: true });
}
