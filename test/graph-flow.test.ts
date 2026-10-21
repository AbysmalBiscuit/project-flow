import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { projectFlowPlaces, projectNodeId } from "../src/graph-flow.ts";
import { run } from "../src/main.ts";
import {
	recordedDiscovery,
	repoReadFromLists,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const widget = "acme/widget";
const alpha = "acme/alpha";
const beta = "acme/beta";
const gamma = "acme/gamma";

function issue(
	repo: string,
	number: number,
	title: string,
	body = "",
	milestone = "Alpha",
): Record<string, unknown> {
	return {
		number,
		title,
		state: "open",
		state_reason: null,
		updated_at: "2026-10-01T00:00:00Z",
		body,
		html_url: `https://github.com/${repo}/issues/${number}`,
		comments: 0,
		labels: [{ name: "ready" }],
		assignee: null,
		milestone: { title: milestone },
	};
}

const issues: Record<string, Record<string, unknown>[]> = {
	[widget]: [
		issue(widget, 90, "Zed the loose"),
		issue(widget, 3, "Chain b end", `Blocked by: ${widget}#2`),
		issue(widget, 2, "Chain b mid", `Blocked by: ${widget}#1`),
		issue(widget, 1, "Chain b start"),
		issue(widget, 13, "Chain a end", `Blocked by: ${widget}#12`, "Beta"),
		issue(widget, 12, "Chain a mid", `Blocked by: ${widget}#11`, "Beta"),
		issue(widget, 11, "Chain a start", "", "Beta"),
		issue(
			widget,
			20,
			"Fork tip",
			`Blocked by: ${widget}#21\nBlocked by: ${widget}#22`,
		),
		issue(widget, 22, "Fork right"),
		issue(widget, 21, "Fork left"),
	],
	[alpha]: [issue(alpha, 1, "Alpha start")],
	[beta]: [
		issue(beta, 2, "Beta waits", `Blocked by: ${alpha}#1`),
		issue(beta, 9, "Beta loose"),
	],
	[gamma]: [issue(gamma, 3, "Gamma waits", `Blocked by: ${beta}#2`)],
};

function page(items: unknown[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function recordedFetch(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
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
		const listed = repoReadFromLists(input, init, issues);
		if (listed !== null) {
			return listed;
		}
		for (const [repo, list] of Object.entries(issues)) {
			if (url.startsWith(`https://api.github.com/repos/${repo}/issues?`)) {
				return page(list);
			}
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			url.includes("/dependencies/")
		) {
			return page([]);
		}
		return unrecorded(input);
	};
}

async function withApp(check: (base: string) => Promise<void>): Promise<void> {
	const { path, cleanup } = await tempConfig(
		JSON.stringify({
			pinned: [
				{ tracker: "github", repo: widget },
				{ tracker: "github", repo: alpha },
				{ tracker: "github", repo: beta },
				{ tracker: "github", repo: gamma },
			],
			checkoutRoots: [],
			pmBot: {
				[widget]: false,
				[alpha]: false,
				[beta]: false,
				[gamma]: false,
			},
			pollIntervalSeconds: 3600,
			theme: "light",
			overview: { view: "graph" },
			projectViews: {
				[widget]: { openView: "graph", groupBy: "none" },
			},
		}),
	);
	const root = await mkdtemp(join(tmpdir(), "project-flow-graph-flow-"));
	const stderr: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base) => {
			check(base).then(resolve).catch(reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
					XDG_DATA_HOME: root,
				},
				fetch: recordedFetch(),
				readGhToken: async () => null,
				listTodos: async () => "",
				listCheckouts: async () => [],
				databasePath: join(root, "store.sqlite"),
				now: () => new Date("2026-10-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				stderr: (line) => stderr.push(line),
				waitForStop: checks,
			}),
		);
		expect(stderr.join("\n")).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("GET /api/projects graph", () => {
	test("a chain of blockers sits on one row and an unrelated chain sits on the next", async () => {
		await withApp(async (base) => {
			const response = await fetch(
				new URL(`/api/projects/${encodeURIComponent(widget)}`, base),
			);
			expect(response.status).toBe(200);
			const report = (await response.json()) as Parameters<
				typeof projectFlowPlaces
			>[0];
			const places = projectFlowPlaces(report, "none", []);
			const row = (key: string) => places.get(projectNodeId(widget, key))?.y;
			expect(row(`${widget}#1`)).toBe(row(`${widget}#3`));
			expect(row(`${widget}#11`)).toBe(row(`${widget}#13`));
			expect(row(`${widget}#1`)).not.toBe(row(`${widget}#11`));
			expect(row(`${widget}#90`)).toBeGreaterThan(row(`${widget}#1`) ?? 0);
			expect(row(`${widget}#21`)).not.toBe(row(`${widget}#22`));
			const again = projectFlowPlaces(report, "none", []);
			expect(
				[...again.entries()].map(([id, place]) => [id, place.x, place.y]),
			).toEqual(
				[...places.entries()].map(([id, place]) => [id, place.x, place.y]),
			);
		});
	});

	test("the same tickets give the same overview places", async () => {
		await withApp(async (base) => {
			const first = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			const second = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(second.projects).toEqual(first.projects);
		});
	});
});
