import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Configuration } from "../src/configuration.ts";
import type { Overview, SettingsProject } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo, trackerRequest, unrecorded } from "./support.ts";

const repos = Array.from({ length: 5 }, (_, index) => `acme/repo-${index}`);
const linearSlugs = Array.from(
	{ length: 5 },
	(_, index) => `board-${index}-0d42ae5d46d0`,
);

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

function linearProject(slugId: string) {
	return { id: `id-${slugId}`, name: `Board ${slugId}`, slugId };
}

function membership(sent: string[]): Fetch {
	return async (input, init) => {
		const request = trackerRequest(input, init);
		const named = request.query.match(/^\s*query\s*(?:(\w+)|\{\s*(\w+))/);
		const operation = named?.[1] ?? named?.[2];
		sent.push(
			operation === undefined
				? request.url
				: operation === "ProjectByPin" || operation === "ProjectIssues"
					? `${request.url} ${operation} ${JSON.stringify(request.variables)}`
					: `${request.url} ${operation}`,
		);
		const url = request.url;
		if (url === "https://api.github.com/user") {
			return json({ login: "lev" });
		}
		if (url.startsWith("https://api.github.com/user/repos")) {
			return json(
				repos.map((repo) => ({
					full_name: repo,
					owner: { login: "lev" },
					permissions: { admin: true, push: true, pull: true },
					pushed_at: "2026-08-18T12:00:00.000Z",
				})),
			);
		}
		const issues = url.match(
			/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
		);
		if (issues?.[1] !== undefined) {
			const since = new URL(url).searchParams.get("since") ?? "";
			return json(
				[
					{
						number: 1,
						title: "Ticket 1",
						state: "open",
						state_reason: null,
						html_url: `https://github.com/${issues[1]}/issues/1`,
						updated_at: "2026-08-18T12:00:00.000Z",
					},
					{
						number: 2,
						title: "Older ticket",
						state: "open",
						state_reason: null,
						html_url: `https://github.com/${issues[1]}/issues/2`,
						updated_at: "2026-03-01T12:00:00.000Z",
					},
				].filter((issue) => issue.updated_at >= since),
			);
		}
		if (url.includes("/pulls?") || url.includes("/branches?")) {
			return json([]);
		}
		if (url === "https://api.github.com/graphql") {
			if (operation === "ViewerProjects" || operation === "OrgProjects") {
				return json({
					data: {
						viewer: {
							login: "lev",
							projectsV2: emptyPage,
							organizations: emptyPage,
						},
					},
				});
			}
			return json({ data: { node: { fields: { nodes: [{}] } } } });
		}
		if (url === "https://api.linear.app/graphql") {
			if (operation === "MemberProjects") {
				return json({
					data: {
						viewer: { id: "lev" },
						projects: {
							nodes: linearSlugs.map((slugId) => ({
								...linearProject(slugId),
								updatedAt: "2026-08-18T12:00:00.000Z",
							})),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				});
			}
			if (operation === "ProjectByPin") {
				const pin = String(request.variables.pin ?? "");
				const slugId = linearSlugs.find((slug) => slug === pin);
				return json({
					data: {
						projects: {
							nodes: slugId === undefined ? [] : [linearProject(slugId)],
						},
					},
				});
			}
			if (operation === "ProjectIssues") {
				return json({
					data: {
						issues: {
							nodes: [
								{
									identifier: "BRD-1",
									title: "Linear ticket 1",
									updatedAt: "2026-08-18T12:00:00.000Z",
									state: { type: "unstarted" },
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				});
			}
			return json({ data: { viewer: { id: "lev" } } });
		}
		return unrecorded(input);
	};
}

type Started = {
	overview: Overview;
	settings: Configuration & { projects: SettingsProject[] };
	sent: string[];
};

async function serve<T>(
	body: string,
	root: string,
	check: (base: string, sent: readonly string[]) => Promise<T>,
): Promise<{ checked: T; sent: string[] }> {
	const { path, cleanup } = await tempConfig(body);
	const sent: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checked = new Promise<T>((resolve, reject) => {
		startChecks = (base) => {
			check(base, sent).then(resolve, reject);
		};
	});
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: membership(sent),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checked.then(() => undefined),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		return { checked: await checked, sent };
	} finally {
		await cleanup();
	}
}

async function read<T>(base: string, path: string): Promise<T> {
	return (await fetch(new URL(path, base))).json() as Promise<T>;
}

async function startWith(body: string, root?: string): Promise<Started> {
	const store =
		root ?? (await mkdtemp(join("/var/tmp", "project-flow-tracked-")));
	try {
		const { checked, sent } = await serve(body, store, (base) =>
			Promise.all([
				read<Overview>(base, "/api/overview"),
				read<Started["settings"]>(base, "/api/settings"),
			]),
		);
		const [overview, settings] = checked;
		return { overview, settings, sent };
	} finally {
		if (root === undefined) {
			await rm(store, { recursive: true, force: true });
		}
	}
}

describe("tracked projects", () => {
	test("a start with no tracked project sends only the membership requests", async () => {
		const { overview, settings, sent } = await startWith("{}");
		expect([...new Set(sent)].sort()).toEqual([
			"https://api.github.com/graphql ViewerProjects",
			"https://api.github.com/user",
			"https://api.github.com/user/repos?affiliation=owner,collaborator&per_page=100&page=1",
			"https://api.linear.app/graphql MemberProjects",
			"https://api.linear.app/graphql viewer",
		]);
		expect(overview.projects).toEqual([]);
		expect(settings.projects).toHaveLength(10);
		expect(settings.projects.every((project) => !project.tracked)).toBe(true);
	});

	test("only the tracked 2 of 10 found projects get ticket and PR requests and show", async () => {
		const tracked = [
			{ tracker: "github", repo: "acme/repo-3" },
			{ tracker: "linear", project: "board-1-0d42ae5d46d0" },
		];
		const { overview, settings, sent } = await startWith(
			JSON.stringify({ tracked }),
		);
		expect(settings.projects).toHaveLength(10);
		expect(
			settings.projects.filter((project) => project.tracked).map((p) => p.key),
		).toEqual(["board-1-0d42ae5d46d0", "acme/repo-3"]);
		expect([...new Set(sent)].sort()).toEqual([
			"https://api.github.com/graphql ViewerProjects",
			"https://api.github.com/repos/acme/repo-3",
			"https://api.github.com/repos/acme/repo-3/branches?per_page=100&page=1",
			"https://api.github.com/repos/acme/repo-3/issues?state=all&per_page=100&page=1",
			"https://api.github.com/repos/acme/repo-3/labels?per_page=100&page=1",
			"https://api.github.com/repos/acme/repo-3/pulls?state=closed&per_page=10&page=1",
			"https://api.github.com/repos/acme/repo-3/pulls?state=open&per_page=100&page=1",
			"https://api.github.com/user",
			"https://api.github.com/user/repos?affiliation=owner,collaborator&per_page=100&page=1",
			"https://api.linear.app/graphql MemberProjects",
			'https://api.linear.app/graphql ProjectByPin {"pin":"board-1-0d42ae5d46d0"}',
			'https://api.linear.app/graphql ProjectIssues {"filter":{"project":{"id":{"eq":"id-board-1-0d42ae5d46d0"}}},"after":null}',
			"https://api.linear.app/graphql viewer",
		]);
		expect(overview.projects.map((project) => project.name)).toEqual([
			"acme/repo-3",
			"Board board-1-0d42ae5d46d0",
		]);
	});

	test("a restart with a shorter tracked list hides the untracked stored project before the first poll ends", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-tracked-"));
		try {
			const first = await startWith(
				JSON.stringify({
					tracked: [
						{ tracker: "github", repo: "acme/repo-3" },
						{ tracker: "github", repo: "acme/repo-1" },
					],
				}),
				root,
			);
			expect(
				first.overview.projects.map((project) => project.name).sort(),
			).toEqual(["acme/repo-1", "acme/repo-3"]);
			const { checked } = await serve(
				JSON.stringify({
					tracked: [{ tracker: "github", repo: "acme/repo-3" }],
				}),
				root,
				(base) => read<Overview>(base, "/api/overview"),
			);
			expect(checked.projects.map((project) => project.name)).toEqual([
				"acme/repo-3",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a re-tracked project gets a full poll after an untrack", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-tracked-"));
		const repo1 = { tracker: "github", repo: "acme/repo-1" };
		const repo3 = { tracker: "github", repo: "acme/repo-3" };
		const save = async (base: string, tracked: unknown[]) => {
			const current = await read<Configuration>(base, "/api/settings");
			const saved = await fetch(new URL("/api/settings", base), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...current, tracked }),
			});
			expect(saved.status).toBe(200);
		};
		try {
			const { checked } = await serve(
				JSON.stringify({ tracked: [repo3, repo1] }),
				root,
				async (base, sent) => {
					await save(base, [repo3]);
					const issuesBefore = sent.length;
					await save(base, [repo3, repo1]);
					return {
						retracked: sent
							.slice(issuesBefore)
							.filter((request) => request.includes("/repo-1/issues?")),
						overview: await read<Overview>(base, "/api/overview"),
					};
				},
			);
			expect(checked.retracked).toEqual([
				"https://api.github.com/repos/acme/repo-1/issues?state=all&per_page=100&page=1",
			]);
			const repo = checked.overview.projects.find(
				(project) => project.name === "acme/repo-1",
			);
			expect(repo?.tickets.map((ticket) => ticket.title).sort()).toEqual([
				"Older ticket",
				"Ticket 1",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a configuration file with pinned and hidden loads and its pinned projects are tracked", async () => {
		const { overview, settings } = await startWith(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: "acme/repo-2" }],
				hidden: [{ tracker: "github", repo: "acme/repo-4" }],
				activityWindowDays: 14,
				overview: { filter: "pinned" },
			}),
		);
		expect(settings.overview.filter).toBe("all");
		expect(settings.tracked).toEqual([
			{ tracker: "github", repo: "acme/repo-2" },
		]);
		expect(settings).not.toHaveProperty("pinned");
		expect(settings).not.toHaveProperty("hidden");
		expect(settings).not.toHaveProperty("activityWindowDays");
		expect(
			settings.projects.filter((project) => project.tracked).map((p) => p.key),
		).toEqual(["acme/repo-2"]);
		expect(overview.projects.map((project) => project.name)).toEqual([
			"acme/repo-2",
		]);
	});
});
