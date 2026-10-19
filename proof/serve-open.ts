import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { recordedDiscovery, urlOf } from "../test/support.ts";

const board = "acme/board";
const gate = "acme/gate";
const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const older = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const codex = "chatgpt-codex-connector[bot]";

function issue(
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
	repo = board,
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-18T12:00:00Z",
		body: "",
		html_url: `https://github.com/${repo}/issues/${number}`,
		...fields,
	};
}

function pull(number: number, ticket: number, draft: boolean) {
	return {
		number,
		title: `PR ${number}`,
		state: "open",
		draft,
		html_url: `https://github.com/${board}/pull/${number}`,
		head: { ref: `${number}-feat-state`, sha: head },
		body: `Closes #${ticket}`,
		merged_at: null,
	};
}

const child = (
	number: number,
	title: string,
	fields: Record<string, unknown> = {},
) =>
	issue(number, title, {
		parent_issue_url: `https://api.github.com/repos/${board}/issues/1`,
		...fields,
	});

const held = (number: number, title: string, blocker: number) =>
	child(number, title, {
		body: `Blocked by: #${blocker}`,
		issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 1 },
	});

const boardIssues = [
	issue(1, "Ship the board", { labels: [{ name: "epic" }] }),
	child(2, "Hold the launch", {
		body: `Blocked by: ${gate}#9`,
		issue_dependencies_summary: { blocked_by: 1, total_blocked_by: 1 },
	}),
	child(3, "Park the notes", {
		state: "closed",
		state_reason: "not_planned",
	}),
	child(4, "Ship the list", {
		state: "closed",
		state_reason: "completed",
	}),
	child(5, "Draft the page"),
	child(6, "Read the review"),
	child(7, "Wait for the merge"),
	child(8, "Leave the copy"),
	held(10, "Hold for the draft", 5),
	held(11, "Hold for the review", 6),
	held(12, "Hold for the merge", 7),
	held(13, "Hold for the copy", 8),
	held(14, "Hold for the epic", 1),
];

const gateIssues = [
	issue(9, "Open the gate", { labels: [{ name: "epic" }] }, gate),
];

const openPulls = [pull(50, 5, true), pull(60, 6, false), pull(70, 7, false)];

const mergedPull = {
	number: 1,
	title: "merged",
	state: "closed",
	draft: false,
	html_url: `https://github.com/${board}/pull/1`,
	head: { ref: "1-merged", sha: older },
	body: "",
	merged_at: "2026-10-01T00:00:00Z",
};

const completedReview = {
	user: { login: codex },
	body: "<!-- codex-pull-request-review-summary -->\n| 📝 **Code Review** | ✅ **Completed** | `aaaaaaaa` | PR opened |",
	created_at: "2026-10-18T11:00:00Z",
};

const localBlocker: Record<string, number> = {
	"2": 9,
	"10": 5,
	"11": 6,
	"12": 7,
	"13": 8,
	"14": 1,
};

const recorded: Fetch = async (input, init) => {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("LinkedDevelopment")
	) {
		return Response.json({
			data: {
				repository: {
					pullRequest: { closingIssuesReferences: { nodes: [] } },
				},
			},
		});
	}
	if (url.startsWith(`https://api.github.com/repos/${board}/issues?`)) {
		return Response.json(boardIssues);
	}
	if (url.startsWith(`https://api.github.com/repos/${gate}/issues?`)) {
		return Response.json(gateIssues);
	}
	const blockedBy = url.match(/\/issues\/(\d+)\/dependencies\/blocked_by$/);
	if (blockedBy?.[1] !== undefined) {
		const blocker = localBlocker[blockedBy[1]];
		if (blocker === undefined) {
			return Response.json([]);
		}
		const other = blocker === 9;
		return Response.json([
			{
				number: blocker,
				state: "open",
				repository_url: `https://api.github.com/repos/${other ? gate : board}`,
			},
		]);
	}
	if (
		url ===
		`https://api.github.com/repos/${board}/pulls?state=open&per_page=100&page=1`
	) {
		return Response.json(openPulls);
	}
	if (
		url ===
		`https://api.github.com/repos/${gate}/pulls?state=open&per_page=100&page=1`
	) {
		return Response.json([]);
	}
	if (url.includes("/pulls?state=closed")) {
		return Response.json(url.includes(board) ? [mergedPull] : []);
	}
	if (url.includes("/branches?")) {
		return Response.json([]);
	}
	if (url.includes("/check-runs")) {
		return Response.json({ check_runs: [] });
	}
	if (url.includes(`/commits/${head}`)) {
		return Response.json({
			commit: { committer: { date: "2026-10-18T10:00:00Z" } },
		});
	}
	if (url.includes("/70/comments") || url.includes("/1/comments")) {
		return Response.json([completedReview]);
	}
	if (
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return Response.json([]);
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
	return new Response(`not recorded ${url}`, { status: 404 });
};

const dir = await mkdtemp(join("/var/tmp", "project-flow-proof-"));
const configPath = join(dir, "config.json");
await writeFile(
	configPath,
	`${JSON.stringify({
		pinned: [
			{ tracker: "github", repo: board },
			{ tracker: "github", repo: gate },
		],
		expectedBots: { [board]: ["codex"] },
		checkoutRoots: [],
	})}\n`,
);

const port = process.env.PORT ?? "4174";
const result = await run(
	["--config", configPath, "--host", "127.0.0.1", "--port", port],
	{
		env: {
			GITHUB_TOKEN: "recorded-token",
			LINEAR_API_KEY: "recorded-linear-key",
			XDG_DATA_HOME: dir,
		},
		fetch: recorded,
		readGhToken: async () => null,
		listTodos: async () => "",
		listCheckouts: async () => [],
		databasePath: join(dir, "project-flow.sqlite"),
		now: () => new Date("2026-10-18T12:00:00.000Z"),
		stdout: (line) => console.log(line),
		stderr: (line) => console.error(line),
		waitForStop: new Promise<void>((resolve) => {
			const stop = () => resolve();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}),
	},
);
process.exit(result.exitCode);
