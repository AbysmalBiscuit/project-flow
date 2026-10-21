import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start } from "../src/app.ts";
import type { Fetch } from "../src/fetch.ts";
import { proofStops } from "./lifetime.ts";

const repo = "acme/widget";
const port = process.argv[2] ?? "4175";
const head = "sha-why";
const question = "Which bot should review this?";
const first = "Keep the current bot";
const second = "Switch to the other bot";
const ask = "<!-- workcell:ask why-1 -->";
const comments = [
	{
		id: 71,
		body: `${question}\n\n1. ${first}\n2. ${second}\n\n${ask}`,
		created_at: "2026-10-01T00:00:00Z",
		user: { login: "agent" },
		html_url: `https://github.com/${repo}/issues/7#issuecomment-71`,
	},
];

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
	if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
		return page([
			{
				number: 7,
				title: "Pick a review bot",
				state: "open",
				state_reason: null,
				updated_at: "2026-10-01T00:00:00Z",
				body: "",
				comments: 1,
				assignee: null,
				labels: [],
			},
			{
				number: 8,
				title: "Ship the widget",
				state: "open",
				state_reason: null,
				updated_at: "2026-10-01T00:00:00Z",
				body: "",
				comments: 0,
				assignee: null,
				labels: [],
			},
			{
				number: 9,
				title: "Needs an engineer",
				state: "open",
				state_reason: null,
				updated_at: "2026-10-01T00:00:00Z",
				body: "",
				assignee: { login: "lev" },
				labels: [{ name: "needs-engineer" }],
				comments: 0,
			},
		]);
	}
	if (url === `https://api.github.com/repos/${repo}/issues/7`) {
		return Response.json({
			title: "Pick a review bot",
			html_url: `https://github.com/${repo}/issues/7`,
		});
	}
	if (url === `https://api.github.com/repos/${repo}/issues/8`) {
		return Response.json({
			title: "Ship the widget",
			html_url: `https://github.com/${repo}/issues/8`,
		});
	}
	if (url === `https://api.github.com/repos/${repo}/issues/9`) {
		return Response.json({
			title: "Needs an engineer",
			html_url: `https://github.com/${repo}/issues/9`,
		});
	}
	if (
		url ===
		`https://api.github.com/repos/${repo}/issues/7/comments?per_page=100&page=1`
	) {
		return page(comments);
	}
	if (
		method === "POST" &&
		url === `https://api.github.com/repos/${repo}/issues/7/comments`
	) {
		const posted = JSON.parse(body) as { body?: string };
		comments.push({
			id: 900,
			body: posted.body ?? "",
			created_at: "2026-10-18T12:01:00Z",
			user: { login: "lev" },
			html_url: `https://github.com/${repo}/issues/7#issuecomment-900`,
		});
		return Response.json(
			{
				id: 900,
				body: posted.body ?? "",
				html_url: `https://github.com/${repo}/issues/7#issuecomment-900`,
				created_at: "2026-10-18T12:01:00Z",
			},
			{ status: 201 },
		);
	}
	if (url.includes(`/repos/${repo}/pulls?state=open`)) {
		return page([
			{
				number: 40,
				title: "Ship the widget",
				state: "open",
				draft: false,
				html_url: `https://github.com/${repo}/pull/40`,
				head: { ref: "40-ship", sha: head },
				body: "Closes #8",
				merged_at: null,
			},
		]);
	}
	if (url.includes(`/commits/${head}/check-runs`)) {
		return Response.json({
			check_runs: [{ name: "ci", status: "completed", conclusion: "success" }],
		});
	}
	if (url.includes("/pulls/40/reviews")) {
		return page([
			{ user: { login: "ada" }, state: "APPROVED", commit_id: head },
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
		url.includes("/labels?") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return page([]);
	}
	return new Response("not recorded", { status: 404 });
};

const root = await mkdtemp(join("/var/tmp", "project-flow-proof-"));
const config = join(root, "config.json");
await writeFile(
	config,
	JSON.stringify({
		pinned: [{ tracker: "github", repo }],
		checkoutRoots: [],
		pmBot: { [repo]: false },
		needsYouLabels: ["needs-human", "needs-engineer"],
		pollIntervalSeconds: 1,
		theme: "light",
	}),
);
process.env.XDG_DATA_HOME = root;

const running = await start({
	configPath: config,
	token: "recorded-token",
	linearKey: "recorded-linear-key",
	fetch: recorded,
	databasePath: join(root, "store.sqlite"),
	hostname: "127.0.0.1",
	port: Number(port),
	listTodos: async () => "",
	listCheckouts: async () => [],
	now: () => new Date("2026-10-18T12:00:00.000Z"),
});
console.log(running.url.href);
await proofStops();
await running.stop();
