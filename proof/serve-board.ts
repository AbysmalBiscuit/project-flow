import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedViewer, urlOf } from "../test/support.ts";

const root = await mkdtemp(join("/var/tmp", "project-flow-board-"));
process.env.XDG_DATA_HOME = root;
const configPath = join(root, "config.json");
const widget = "acme/widget";
const platform = "acme/platform";

await writeFile(
	configPath,
	JSON.stringify({
		pinned: [
			{ tracker: "github", repo: widget },
			{ tracker: "github", repo: platform },
			{ tracker: "linear", project: "gate" },
		],
		pollIntervalSeconds: 3600,
	}),
);

function issue(
	repo: string,
	number: number,
	title: string,
	body = "",
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: `2026-08-${String(number).padStart(2, "0")}T12:00:00Z`,
		html_url: `https://github.com/${repo}/issues/${number}`,
		body,
	};
}

const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const widgetIssues = [
	issue(widget, 1, "Ship the board"),
	issue(
		widget,
		2,
		"Draw the nodes",
		`Blocked by: ${widget}#1\nBlocked by: ${platform}#9\nBlocked by: https://linear.app/acme/issue/PF-3\nBlocks: ${platform}#10`,
	),
	issue(widget, 3, "Write the copy"),
	issue(widget, 4, "Read the review"),
	issue(widget, 5, "Merge the board"),
	...[11, 12, 13, 14, 15, 16].map((number): Record<string, unknown> => {
		const closed = issue(widget, number, `Close item ${number}`, "", "closed");
		return {
			...closed,
			closed_at:
				number === 16 ? "2026-08-17T12:00:00Z" : "2026-08-01T12:00:00Z",
			updated_at:
				number === 16 ? "2026-08-17T12:00:00Z" : "2026-08-01T12:00:00Z",
		};
	}),
];

const widgetPulls = [
	{
		number: 31,
		title: "Review the copy",
		state: "open",
		draft: false,
		html_url: `https://github.com/${widget}/pull/31`,
		head: { ref: "review-copy", sha: head },
		body: "Closes #4",
		merged_at: null,
	},
	{
		number: 41,
		title: "Merge the board",
		state: "open",
		draft: false,
		html_url: `https://github.com/${widget}/pull/41`,
		head: { ref: "merge-board", sha: head },
		body: "Closes #5",
		merged_at: null,
	},
];

const platformIssues = [
	issue(platform, 9, "Platform gate"),
	issue(platform, 10, "Hold the launch", `Blocked by: ${widget}#2`),
];

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

const gateIssue = {
	identifier: "PF-3",
	title: "Hold the gate",
	description: "The launch waits on this gate.",
	updatedAt: "2026-08-09T12:00:00Z",
	state: { id: "backlog", name: "Backlog", type: "backlog", color: "#bec2c8" },
	parent: null,
	projectMilestone: null,
	labels: { nodes: [] },
	assignee: null,
	attachments: { nodes: [] },
	comments: {
		nodes: [
			{
				id: "gate-note",
				body: "The gate note is ready.",
				createdAt: "2026-08-09T12:00:00Z",
				user: { name: "Ada", displayName: "Ada" },
				reactions: [],
			},
		],
		pageInfo: { hasNextPage: false, endCursor: null },
	},
	history: { nodes: [] },
	inverseRelations: { nodes: [] },
};

function linearResponse(body: string): Response {
	if (body.includes("MemberProjects") || body.includes("viewer { id }")) {
		return Response.json({
			data: {
				viewer: { id: "lev" },
				projects: emptyPage,
			},
		});
	}
	if (body.includes("ProjectByPin")) {
		return Response.json({
			data: {
				projects: {
					nodes: [
						{
							id: "gate",
							name: "Gate",
							slugId: "gate",
							teams: { nodes: [] },
						},
					],
				},
			},
		});
	}
	if (body.includes("ProjectIssues")) {
		return Response.json({
			data: { issues: { nodes: [gateIssue], pageInfo: emptyPage.pageInfo } },
		});
	}
	if (body.includes("IssueThread")) {
		return Response.json({
			data: {
				issue: {
					identifier: "PF-3",
					title: "Hold the gate",
					url: "https://linear.app/issue/PF-3",
					comments: {
						nodes: [
							{
								id: "gate-note",
								body: "The gate note is ready.",
								createdAt: "2026-08-09T12:00:00Z",
								url: "https://linear.app/issue/PF-3#comment-gate-note",
								parent: null,
								user: { name: "Ada", displayName: "Ada" },
							},
						],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
	}
	return Response.json({ data: {} });
}

const recorded: Fetch = async (input, init) => {
	const known = recordedViewer(input, init);
	if (known !== null) {
		return known;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.linear.app/graphql") {
		return linearResponse(body);
	}
	if (url.includes(`/repos/${widget}/issues?`)) {
		return page(widgetIssues);
	}
	if (url.includes(`/repos/${widget}/pulls?`) && url.includes("state=open")) {
		return page(widgetPulls);
	}
	if (url.includes(`/repos/${widget}/pulls?`) && url.includes("state=closed")) {
		return page([
			{
				number: 1,
				title: "merged",
				state: "closed",
				draft: false,
				html_url: `https://github.com/${widget}/pull/1`,
				head: { ref: "1-merged", sha: head },
				body: "",
				merged_at: "2026-08-01T12:00:00Z",
			},
		]);
	}
	if (url.includes(`/repos/${widget}/branches?`)) {
		return page([{ name: "3-feat-write-the-copy" }]);
	}
	if (url.includes("/commits/") && url.includes("/check-runs")) {
		return Response.json({
			check_runs: [
				{
					name: "Grok code review",
					status: "completed",
					conclusion: "success",
					app: { slug: "grok-code-review" },
				},
			],
		});
	}
	if (url.includes("/pulls/") && url.includes("/reviews")) {
		const number = Number(/\/pulls\/(\d+)\//.exec(url)?.[1] ?? "0");
		const commitId =
			number === 41 ? head : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
		if (number === 1 || number === 31 || number === 41) {
			return page([
				{
					user: { login: "grok-code-review[bot]" },
					commit_id: commitId,
					state: "COMMENTED",
				},
			]);
		}
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("closingIssuesReferences")
	) {
		const number = Number(/"number":\s*(\d+)/.exec(body)?.[1] ?? "0");
		const found = widgetPulls.find((item) => item.number === number);
		const closing = found?.body.match(/Closes #(\d+)/);
		return Response.json({
			data: {
				repository: {
					pullRequest: {
						closingIssuesReferences: {
							nodes:
								closing?.[1] === undefined
									? []
									: [{ number: Number(closing[1]) }],
						},
					},
				},
			},
		});
	}
	if (url.includes(`/repos/${platform}/issues?`)) {
		return page(platformIssues);
	}
	const issueUrl = url.match(
		/https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/,
	);
	if (issueUrl?.[1] !== undefined && issueUrl[2] !== undefined) {
		const repo = issueUrl[1];
		const number = Number(issueUrl[2]);
		const found = [...widgetIssues, ...platformIssues].find(
			(item) => item.number === number && String(item.html_url).includes(repo),
		);
		if (found === undefined) {
			return new Response("not recorded", { status: 404 });
		}
		return new Response(JSON.stringify(found), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (url.endsWith("/comments") && url.includes("/issues/")) {
		return page([
			{
				id: 70,
				body: "The notes are ready.",
				user: { login: "lev" },
				html_url: `${url}#issuecomment-70`,
				created_at: "2026-08-18T12:00:00Z",
			},
		]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reactions")
	) {
		return page([]);
	}
	return new Response("not recorded", { status: 404 });
};

const port = Number(process.argv[2] ?? process.env.PORT ?? "4173");
let base = "";
try {
	await run(["--config", configPath, "--host", "127.0.0.1", "--port", "0"], {
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(root, "project-flow.sqlite"),
		now: () => new Date("2026-08-18T12:00:00.000Z"),
		stdout: (line) => {
			base = line.trim();
		},
		stderr: (line) => console.error(line),
		waitForStop: (async () => {
			const deadline = Date.now() + 8_000;
			while (Date.now() < deadline) {
				if (base !== "") {
					const loaded = await fetch(
						new URL(`/api/projects/${encodeURIComponent(widget)}`, base),
					).catch(() => null);
					if (loaded?.ok) {
						const body = (await loaded.json()) as {
							tickets?: {
								title?: string;
								outsideBlockers?: { key?: string }[];
							}[];
						};
						const titled = body.tickets?.some(
							(ticket) => ticket.title === "Ship the board",
						);
						const outside = body.tickets?.some((ticket) =>
							ticket.outsideBlockers?.some((blocker) => blocker.key === "PF-3"),
						);
						if (titled && outside) {
							const internal = new URL(base);
							Bun.serve({
								hostname: "127.0.0.1",
								port,
								fetch(request) {
									const url = new URL(request.url);
									url.protocol = internal.protocol;
									url.hostname = internal.hostname;
									url.port = internal.port;
									return fetch(
										new Request(url, {
											method: request.method,
											headers: request.headers,
											body: request.body,
										}),
									);
								},
							});
							console.log(`http://127.0.0.1:${port}/`);
							return new Promise<void>((resolve) => {
								const stop = () => resolve();
								process.once("SIGINT", stop);
								process.once("SIGTERM", stop);
							});
						}
					}
				}
				await new Promise((pause) => setTimeout(pause, 50));
			}
			throw new Error("project load returned no board ticket");
		})(),
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
