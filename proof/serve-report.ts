import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/main.ts";
import { answerRecordedRepoRead } from "../test/recorded-read.ts";
import { proofStops } from "./lifetime.ts";

const githubRepo = "acme/widget";
const otherRepo = "acme/platform";
const linearSlug = "widget-launch";
const port = process.argv[2] ?? "4173";

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
	repo = githubRepo,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

const githubIssues = [
	issue(1, "Ship the map", {
		labels: [{ name: "epic" }],
		milestone: { title: "October" },
	}),
	issue(2, "feat(ux): draw the nodes", {
		parent_issue_url: `https://api.github.com/repos/${githubRepo}/issues/1`,
		milestone: { title: "October" },
		body: `Blocked by: ${otherRepo}#9`,
	}),
	issue(3, "Write the copy", {
		milestone: { title: "October" },
	}),
	issue(4, "Draft the page", {
		body: "A draft exists.",
	}),
];

const otherIssues = [
	issue(9, "Platform gate", { labels: [{ name: "epic" }] }, otherRepo),
];

async function recorded(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return Response.json([]);
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
	if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
		return Response.json(githubIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${otherRepo}/issues?`)) {
		return Response.json(otherIssues);
	}
	if (url.includes("/pulls?")) {
		if (url.includes(githubRepo)) {
			return Response.json([
				{
					number: 40,
					title: "Fix the legend",
					state: "open",
					draft: true,
					html_url: `https://github.com/${githubRepo}/pull/40`,
					head: { ref: "legend" },
					body: "",
				},
			]);
		}
		return Response.json([]);
	}
	if (url.includes("/branches?")) {
		if (url.includes(githubRepo)) {
			return Response.json([{ name: "4-draft-the-page" }]);
		}
		return Response.json([]);
	}
	if (url.endsWith("/comments")) {
		return Response.json([]);
	}
	if (
		url === "https://api.linear.app/graphql" &&
		body.includes("MemberProjects")
	) {
		return Response.json({
			data: {
				viewer: { id: "lev" },
				projects: {
					nodes: [
						{
							id: "project-widget",
							name: "Widget launch",
							slugId: linearSlug,
							updatedAt: "2026-08-18T12:00:00.000Z",
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	if (url === "https://api.linear.app/graphql" && body.includes("viewer")) {
		return Response.json({ data: { viewer: { id: "lev" } } });
	}
	if (
		url === "https://api.linear.app/graphql" &&
		body.includes("ProjectByPin")
	) {
		return Response.json({
			data: {
				projects: {
					nodes: [
						{
							id: "project-widget",
							name: "Widget launch",
							slugId: linearSlug,
						},
					],
				},
			},
		});
	}
	if (
		url === "https://api.linear.app/graphql" &&
		body.includes("ProjectIssues")
	) {
		return Response.json({
			data: {
				issues: {
					nodes: [
						{
							identifier: "WID-1",
							title: "Launch epic",
							description: "",
							state: { type: "started" },
							updatedAt: "2026-08-18T12:00:00.000Z",
							parent: null,
							projectMilestone: { name: "Beta" },
							labels: { nodes: [{ name: "epic" }] },
						},
						{
							identifier: "WID-4",
							title: "Ship the list",
							description: "",
							state: { type: "unstarted" },
							updatedAt: "2026-08-18T12:00:00.000Z",
							parent: { identifier: "WID-1" },
							projectMilestone: null,
							labels: { nodes: [] },
						},
						{
							identifier: "WID-2",
							title: "feat(api): list projects",
							description: `Blocked by: ${otherRepo}#9`,
							state: { type: "unstarted" },
							updatedAt: "2026-08-18T12:00:00.000Z",
							parent: { identifier: "WID-4" },
							projectMilestone: { name: "Later" },
							labels: { nodes: [] },
						},
						{
							identifier: "WID-3",
							title: "Write the notes",
							description: "",
							state: { type: "backlog" },
							updatedAt: "2026-08-18T12:00:00.000Z",
							parent: null,
							projectMilestone: { name: "Beta" },
							labels: { nodes: [] },
						},
					],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
			},
		});
	}
	return new Response("not recorded", { status: 404 });
}

const dir = await mkdtemp(join(tmpdir(), "project-flow-proof-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: githubRepo },
			{ tracker: "github", repo: otherRepo },
			{ tracker: "linear", project: linearSlug },
		],
	}),
);
const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", port],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: answerRecordedRepoRead(recorded),
		readGhToken: async () => null,
		databasePath: join(dir, "store.sqlite"),
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: proofStops(),
	},
);
process.exit(result.exitCode);
