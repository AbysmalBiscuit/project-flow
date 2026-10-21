import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-105-proof-"));
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		theme: "light",
		overview: {
			filter: "all",
			sort: "project",
			direction: "asc",
			view: "table",
		},
		pinned: [
			{ tracker: "github", repo: "acme/alpha" },
			{ tracker: "github", repo: "acme/beta" },
			{ tracker: "github", repo: "acme/gamma" },
			{ tracker: "linear", project: "platform" },
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

const factoryLabels = [
	{ name: "ready", color: "d0d7de" },
	{ name: "factory: running", color: "f0c674" },
	{ name: "factory: in-review", color: "9ecbff" },
];

function issue(
	repo: string,
	number: number,
	title: string,
	label: string,
	needsYou: boolean,
	body = "",
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${repo}/issues/${number}`,
		updated_at: "2026-08-01T12:00:00.000Z",
		body,
		labels: needsYou
			? [{ name: label }, { name: "needs-human" }]
			: [{ name: label }],
		assignee: needsYou ? { login: "lev" } : null,
	};
}

function graphIssue(
	repo: string,
	number: number,
	title: string,
	needsYou: boolean,
	blockedBy = 0,
): Record<string, unknown> {
	return {
		...issue(repo, number, title, "ready", needsYou),
		labels: needsYou ? [{ name: "needs-human" }] : [],
		issue_dependencies_summary: {
			blocked_by: blockedBy,
			total_blocked_by: blockedBy,
		},
	};
}

const alphaIssues = [
	issue("acme/alpha", 1, "Alpha ready", "ready", false),
	issue("acme/alpha", 2, "Alpha running", "factory: running", false),
	issue("acme/alpha", 3, "Alpha review", "factory: in-review", true),
];

const betaIssues = [
	issue("acme/beta", 4, "Beta ready one", "ready", false),
	issue("acme/beta", 5, "Beta ready two", "ready", false),
	issue(
		"acme/beta",
		6,
		"Beta blocked",
		"factory: running",
		true,
		"Blocked by: acme/alpha#1",
	),
	issue("acme/beta", 7, "Beta review", "factory: in-review", false),
	issue("acme/beta", 8, "Beta review two", "factory: in-review", false),
	issue("acme/beta", 13, "Beta needs you", "ready", true),
];

const gammaIssues = [
	issue("acme/gamma", 9, "Gamma done", "ready", false, "", "closed"),
	issue("acme/gamma", 10, "Gamma review", "factory: in-review", false),
	issue(
		"acme/gamma",
		11,
		"Gamma blocked",
		"ready",
		false,
		"Blocked by: acme/beta#4",
	),
];

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const fakeTrackers: Fetch = async (input, init) => {
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
		if (body.includes("LinkedDevelopment")) {
			const number = body.match(/"number":(\d+)/)?.[1];
			return json({
				data: {
					repository: {
						pullRequest: {
							closingIssuesReferences: {
								nodes: number === "12" ? [{ number: 10 }] : [],
							},
						},
					},
				},
			});
		}
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
		if (body.includes("LinkedPulls")) {
			return json({
				data: {
					repository: {
						issue: {
							closedByPullRequestsReferences: { nodes: [] },
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
		if (body.includes("MemberProjects")) {
			return json({
				data: {
					projects: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		}
		if (body.includes("viewer { id }") || body.includes("query Viewer")) {
			return json({ data: { viewer: { id: "lev" } } });
		}
		if (body.includes("ProjectByPin")) {
			return json({
				data: {
					projects: {
						nodes: [
							{
								id: "platform-id",
								name: "Platform",
								slugId: "platform",
								teams: {
									nodes: [{ id: "team-1", key: "PLAT", name: "Platform" }],
								},
							},
						],
					},
				},
			});
		}
		if (body.includes("TeamStates")) {
			return json({
				data: {
					team: {
						states: {
							nodes: [
								{
									id: "todo",
									name: "Todo",
									type: "unstarted",
									position: 1,
									color: "#d0d7de",
								},
								{
									id: "started",
									name: "In Progress",
									type: "started",
									position: 2,
									color: "#f0c674",
								},
							],
						},
					},
				},
			});
		}
		if (body.includes("ProjectIssues")) {
			return json({
				data: {
					issues: {
						nodes: [
							{
								identifier: "PLAT-1",
								title: "Platform ticket",
								description: "",
								updatedAt: "2026-08-01T12:00:00.000Z",
								state: {
									id: "started",
									name: "In Progress",
									type: "started",
									color: "#f0c674",
								},
								parent: null,
								projectMilestone: null,
								labels: { nodes: [] },
								assignee: null,
								attachments: { nodes: [] },
								comments: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								history: { nodes: [] },
								inverseRelations: { nodes: [] },
							},
							{
								identifier: "PLAT-2",
								title: "Platform review",
								description: "",
								updatedAt: "2026-08-01T12:00:00.000Z",
								state: {
									id: "todo",
									name: "Todo",
									type: "unstarted",
									color: "#d0d7de",
								},
								parent: null,
								projectMilestone: null,
								labels: { nodes: [] },
								assignee: null,
								attachments: { nodes: [] },
								comments: {
									nodes: [],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								history: { nodes: [] },
								inverseRelations: { nodes: [] },
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		}
		return json({ data: {} });
	}
	const issues = url.match(
		/^https:\/\/api\.github\.com\/repos\/(acme\/(?:alpha|beta|gamma))\/issues\?/,
	);
	if (issues?.[1] === "acme/alpha") {
		return json(alphaIssues);
	}
	if (issues?.[1] === "acme/beta") {
		return json(betaIssues);
	}
	if (issues?.[1] === "acme/gamma") {
		return json(gammaIssues);
	}
	if (url.includes("/labels?")) {
		return json(factoryLabels);
	}
	if (url.includes("/acme/gamma/pulls?")) {
		if (url.includes("state=closed")) {
			return json([]);
		}
		return json([
			{
				number: 12,
				title: "Gamma merge",
				html_url: "https://github.com/acme/gamma/pull/12",
				draft: false,
				body: "Closes #10",
				head: { ref: "gamma-merge", sha: "abc123" },
				state: "open",
				merged_at: null,
				auto_merge: null,
			},
		]);
	}
	if (url.includes("/commits/abc123/check-runs")) {
		return json({ check_runs: [] });
	}
	if (url.includes("/commits/abc123")) {
		return json({
			commit: { committer: { date: "2026-08-01T12:00:00.000Z" } },
		});
	}
	if (url.includes("/issues/12/comments")) {
		return json([
			{
				user: { login: "lev" },
				body: "**Workcell progress**\n- final report",
				created_at: "2026-08-02T12:00:00.000Z",
				reactions: { total_count: 0 },
			},
			{
				user: { login: "lev" },
				body: "<!-- workcell:report -->\nfinal report\nhttps://github.com/acme/gamma/pull/12",
				created_at: "2026-08-02T12:01:00.000Z",
				reactions: { total_count: 0 },
			},
		]);
	}
	if (url.includes("/repos/acme/beta/issues/2/dependencies/blocked_by")) {
		return json([
			{
				number: 1,
				title: "Alpha ticket",
				state: "open",
				repository_url: "https://api.github.com/repos/acme/alpha",
			},
		]);
	}
	const oneIssue = url.match(
		/^https:\/\/api\.github\.com\/repos\/(acme\/(?:alpha|beta))\/issues\/(\d+)$/,
	);
	if (oneIssue?.[1] === "acme/alpha" && oneIssue[2] === "1") {
		return json(graphIssue("acme/alpha", 1, "Alpha ticket", false));
	}
	if (oneIssue?.[1] === "acme/beta" && oneIssue[2] === "2") {
		return json(graphIssue("acme/beta", 2, "Beta ticket", true, 1));
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/pulls/") ||
		url.includes("/branches?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return json([]);
	}
	return new Response("not recorded", { status: 404 });
};

const portFlag = process.argv.indexOf("--port");
const portArg = portFlag === -1 ? undefined : process.argv[portFlag + 1];
const port = portArg ?? process.env.PORT ?? "4763";
const holdRefresh = process.argv.includes("--hold-refresh");
let issueReads = 0;
let releaseHeld: (() => void) | null = null;
const heldPoll = new Promise<void>((resolve) => {
	releaseHeld = resolve;
});
const recordedFetch = fakeTrackers;
const fetchImpl: Fetch = async (input, init) => {
	const target =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	if (
		holdRefresh &&
		/^https:\/\/api\.github\.com\/repos\/acme\/(?:alpha|beta|gamma)\/issues\?/.test(
			target,
		)
	) {
		issueReads += 1;
		if (issueReads > 3) {
			await heldPoll;
		}
	}
	return recordedFetch(input, init);
};

try {
	const result = await run(["--config", configPath, "--port", port], {
		env: {
			...process.env,
			XDG_DATA_HOME: root,
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: fetchImpl,
		readGhToken: async () => null,
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date(),
		listTodos: async () => "",
		listCheckouts: async () => [],
		stdout: (line) => {
			console.log(line);
			if (!holdRefresh) {
				return;
			}
			const events = new URL("/api/events", line);
			void (async () => {
				const stream = await fetch(events);
				const reader = stream.body?.getReader();
				if (reader === undefined) {
					return;
				}
				const decoder = new TextDecoder();
				let buffer = "";
				let sawRunning = false;
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) {
						return;
					}
					buffer += decoder.decode(chunk.value, { stream: true });
					if (!sawRunning && buffer.includes('"polling":true')) {
						sawRunning = true;
						setTimeout(() => {
							releaseHeld?.();
						}, 1_500).unref();
					}
				}
			})();
		},
		stderr: (line) => console.error(line),
		waitForStop: stop,
	});
	if (result.exitCode !== 0) {
		process.exitCode = result.exitCode;
	}
} finally {
	await rm(root, { recursive: true, force: true });
}
