import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	urlOf,
} from "./support.ts";

const githubRepo = "acme/widget";
const otherRepo = "acme/platform";
const linearSlug = "widget-launch";

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

function page(items: Record<string, unknown>[]): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
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

function githubFetch(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return page(githubIssues);
		}
		if (url.startsWith(`https://api.github.com/repos/${otherRepo}/issues?`)) {
			return page(otherIssues);
		}
		if (url.includes("/pulls?")) {
			if (url.includes(githubRepo)) {
				return page([
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
			return page([]);
		}
		if (url.includes("/branches?")) {
			if (url.includes(githubRepo)) {
				return page([{ name: "4-draft-the-page" }]);
			}
			return page([]);
		}
		if (url.endsWith("/comments")) {
			return page([]);
		}
		return new Response("not recorded", { status: 404 });
	};
}

const linearIssues = [
	{
		id: "parent",
		identifier: "WID-1",
		title: "Launch epic",
		description: "",
		state: { type: "started" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		projectMilestone: { name: "Beta" },
		labels: { nodes: [{ name: "epic" }] },
		parent: null,
	},
	{
		id: "story",
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
		id: "child",
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
		id: "backlog",
		identifier: "WID-3",
		title: "Write the notes",
		description: "",
		state: { type: "backlog" },
		updatedAt: "2026-08-18T12:00:00.000Z",
		parent: null,
		projectMilestone: { name: "Beta" },
		labels: { nodes: [] },
	},
];

type Report = {
	name: string;
	tracker: string;
	summary: string;
	highlight: string | null;
	sections: {
		id: string;
		title: string;
		text?: string;
		items?: { key: string | null; title: string; state: string }[];
		diagrams?: {
			id: string;
			definition: string;
			nodes: { id: string; dashed: boolean; label: string }[];
		}[];
	}[];
	diagrams: { id: string; definition: string }[];
};

async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
): Promise<void> {
	const { path, cleanup } = await tempConfig(config);
	const root = await mkdtemp(join(tmpdir(), "project-flow-store-"));
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
				env,
				fetch: fetchImpl,
				readGhToken: async () => null,
				databasePath: join(root, "store.sqlite"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("GET /api/projects/:name", () => {
	test("the same tracker data gives the same groups and diagram definitions", async () => {
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "github", repo: githubRepo },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const first = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as Report;
				const second = (await (
					await fetch(
						new URL(`/api/projects/${encodeURIComponent(githubRepo)}`, base),
					)
				).json()) as Report;
				expect(second).toEqual(first);
				expect(first.sections.map((section) => section.id)).toEqual([
					"summary",
					"featureMap",
					"inFlight",
					"blockingChains",
					"backlog",
				]);
				expect(first.summary).toBe(
					"acme/widget: 0 done, 0 dropped, 1 blocked, 1 in progress, 0 in review, 0 awaiting merge, 2 backlog.",
				);
				const map = first.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(map?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_no_workstream",
					"map_October",
					"map_Ship_the_map",
				]);
				const epicMap = map?.diagrams?.find(
					(diagram) => diagram.id === "map_Ship_the_map",
				);
				expect(epicMap?.definition).toContain(
					'acme_widget_2["feat(ux): draw the nodes"]:::blocked',
				);
				expect(epicMap?.definition).toContain(
					"github_acme_platform_acme_platform_9",
				);
				expect(epicMap?.nodes.some((node) => node.dashed)).toBe(true);
				const october = map?.diagrams?.find(
					(diagram) => diagram.id === "map_October",
				);
				expect(october?.definition).not.toContain("acme_widget_2");
				const flight = first.sections.find(
					(section) => section.id === "inFlight",
				);
				expect(flight?.items?.map((item) => item.key)).toEqual([
					"acme/widget#4",
					"#40",
				]);
				const backlog = first.sections.find(
					(section) => section.id === "backlog",
				);
				expect(backlog?.items?.map((item) => item.key)).toEqual([
					"acme/widget#1",
					"acme/widget#3",
				]);
			},
		);
		await withApp(
			JSON.stringify({
				pinned: [
					{ tracker: "linear", project: linearSlug },
					{ tracker: "github", repo: otherRepo },
				],
			}),
			linearFake({
				project: {
					id: "project-widget",
					name: "Widget launch",
					slugId: linearSlug,
				},
				issues: linearIssues,
				github: githubFetch(),
			}),
			{ GITHUB_TOKEN: "recorded-token", LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const linearReport = (await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as Report;
				const again = (await (
					await fetch(new URL("/api/projects/Widget%20launch", base))
				).json()) as Report;
				expect(again.diagrams.map((diagram) => diagram.definition)).toEqual(
					linearReport.diagrams.map((diagram) => diagram.definition),
				);
				expect(linearReport.sections.map((section) => section.title)).toEqual([
					"Summary",
					"Feature map",
					"In flight",
					"Blocking chains",
					"Backlog",
				]);
				expect(linearReport.summary).toContain("1 blocked");
				expect(linearReport.summary).toContain("3 backlog");
				const linearMap = linearReport.sections.find(
					(section) => section.id === "featureMap",
				);
				expect(linearMap?.diagrams?.map((diagram) => diagram.id)).toEqual([
					"map_Beta",
				]);
				const beta = linearMap?.diagrams?.[0]?.definition ?? "";
				expect(beta).toContain("WID_2");
				expect(beta).toContain("Launch epic");
				expect(beta).toContain(":::dashed");
				expect(
					linearMap?.diagrams?.some((diagram) => diagram.id === "map_Later"),
				).toBe(false);
				const chains = linearReport.sections.find(
					(section) => section.id === "blockingChains",
				);
				expect(chains?.diagrams?.[0]?.definition).toContain("WID_2");
			},
		);
	});

	test("a missing project is not found, and a blank name is not found", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			githubFetch(),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const missing = await fetch(new URL("/api/projects/missing", base));
				expect(missing.status).toBe(404);
				const blank = await fetch(new URL("/api/projects/%20", base));
				expect(blank.status).toBe(404);
				const spaced = await fetch(
					new URL(`/api/projects/${encodeURIComponent("acme/widget  ")}`, base),
				);
				expect(spaced.status).toBe(404);
				const pageResponse = await fetch(
					new URL(`/projects/${encodeURIComponent(githubRepo)}`, base),
				);
				expect(pageResponse.status).toBe(200);
				const html = await pageResponse.text();
				expect(html).toContain('id="root"');
				expect(html).not.toContain("Feature map");
			},
		);
	});
});
