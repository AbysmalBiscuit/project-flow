import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const repo = "acme/widget";
const port = process.argv[2] ?? "4173";
const ask = "<!-- workcell:ask pf-1 -->";
const question = "Which bot should review this?";

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const recorded: Fetch = async (input, init) => {
	const url = String(input instanceof Request ? input.url : input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return page([]);
	}
	if (url === "https://api.github.com/graphql") {
		if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
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
		return Response.json({
			data: {
				repository: {
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
		});
	}
	if (url === "https://api.linear.app/graphql") {
		if (body.includes("MemberProjects") || body.includes("viewer")) {
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
		return Response.json({
			data: {
				issues: {
					nodes: [
						{
							id: "PF-1",
							identifier: "PF-1",
							title: "Open ask",
							description: "",
							state: { type: "unstarted" },
							updatedAt: "2026-08-18T12:00:00.000Z",
							labels: { nodes: [] },
							comments: {
								nodes: [{ body: `${question}\n\n${ask}` }],
							},
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([
			{
				number: 8,
				title: "Ready to merge",
				state: "open",
				state_reason: null,
				updated_at: "2026-10-01T00:00:00Z",
				body: "",
				assignee: { login: "someone" },
				labels: [],
			},
		]);
	}
	if (url.includes("/pulls?state=open")) {
		return page([
			{
				number: 40,
				title: "Ship it",
				state: "open",
				draft: false,
				html_url: `https://github.com/${repo}/pull/40`,
				head: {
					ref: "8-ready-to-merge",
					sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				},
				body: "Closes #8",
				merged_at: null,
			},
		]);
	}
	if (url.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (url.includes("/commits/")) {
		return Response.json({
			commit: { committer: { date: "2026-10-01T00:00:00Z" } },
		});
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return page([]);
	}
	return new Response("not recorded", { status: 404 });
};

const root = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [
			{ tracker: "linear", project: "project-flow" },
			{ tracker: "github", repo },
		],
		checkoutRoots: [],
		needsYouLabels: ["needs-human", "needs-engineer"],
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
	now: () => new Date("2026-10-18T12:00:00.000Z"),
	stdout: (line) => {
		console.log(line);
	},
	waitForStop: new Promise(() => {}),
});
