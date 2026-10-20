import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import approvedState from "./fixtures/linear-approved-state.json";
import historyNode from "./fixtures/linear-history-node.json";
import teamStates from "./fixtures/linear-team-states.json";
import {
	linearFake,
	recordedDiscovery,
	tempConfig,
	testIo,
	unrecorded,
	urlOf,
} from "./support.ts";

const fixtureDir = join(import.meta.dir, "fixtures");
const linearSlug = "widget-launch";
const githubRepo = "acme/widget";
const todoState = {
	id: "364b3510-9325-4af6-9df1-8f2ff56f7a3d",
	name: "Todo",
	type: "unstarted",
	color: "#e2e2e2",
};
const progressState = {
	id: "cce36b04-d482-4233-b1d8-33eda76ca025",
	name: "In Progress",
	type: "started",
	color: "#f2c94c",
};
const reviewState = {
	id: "558ba933-745c-42e2-8969-b3757c54bd5c",
	name: "In Review",
	type: "started",
	color: "#4cb782",
};
const linearTeam = {
	id: "team-widget",
	key: "WID",
	name: "Widget",
};
const linearProject = {
	id: "project-widget",
	name: "Widget launch",
	slugId: linearSlug,
	teams: { nodes: [linearTeam] },
};

type FlightItem = {
	key: string | null;
	title: string;
	state: string;
	lane: string;
	statusType: string;
	blocked?: boolean;
	staleStatus?: string;
	chips?: string[];
	enteredStateAt?: string;
};

type NeedsYouItem = {
	key: string;
	reason: string;
};

type ProjectBody = {
	lanes: { name: string; statusType: string }[];
	sections: {
		id: string;
		items?: FlightItem[];
		needsYou?: NeedsYouItem[];
	}[];
};

type RecordedPull = {
	number: number;
	title: string;
	html_url: string;
	draft?: boolean;
	body: string | null;
	head: { ref: string; sha: string };
	state: string;
	merged_at?: string | null;
	auto_merge?: unknown;
};

function page(items: unknown): Response {
	return new Response(JSON.stringify(items), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

async function recordedJson(name: string): Promise<unknown> {
	return JSON.parse(await readFile(join(fixtureDir, name), "utf8"));
}

function linearIssue(
	identifier: string,
	title: string,
	state: { id: string; name: string; type: string; color: string },
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		identifier,
		title,
		description: "",
		updatedAt: "2026-08-18T12:00:00.000Z",
		state,
		parent: null,
		projectMilestone: null,
		labels: { nodes: [] },
		...fields,
	};
}

function progress(lines: string): string {
	return `**Workcell progress**\n\n${lines}`;
}

function pullAs(
	recorded: RecordedPull,
	fields: { number?: number; body?: string; state?: string } = {},
): Record<string, unknown> {
	const number = fields.number ?? recorded.number;
	return {
		...recorded,
		number,
		html_url: `https://github.com/${githubRepo}/pull/${number}`,
		...(fields.body === undefined ? {} : { body: fields.body }),
		...(fields.state === undefined ? {} : { state: fields.state }),
	};
}

function githubIssue(
	number: number,
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state: "open",
		state_reason: null,
		updated_at: "2026-08-18T12:00:00.000Z",
		body: "",
		html_url: `https://github.com/${githubRepo}/issues/${number}`,
		labels: [],
		comments: 0,
		...fields,
	};
}

function recordedLinear(
	issues: Record<string, unknown>[],
	github?: Fetch,
	branches: { name: string }[] = [],
): Fetch {
	return linearFake({
		project: linearProject,
		states: teamStates.data.team.states.nodes,
		issues,
		...(github === undefined
			? branches.length === 0
				? {}
				: {
						github: async (input: string | URL | Request) => {
							const url = urlOf(input);
							if (url.includes("/branches?")) {
								return page(branches);
							}
							return unrecorded(input);
						},
					}
			: { github }),
	});
}

function recordedRepo(
	issues: Record<string, unknown>[],
	pulls: Record<string, unknown>[] = [],
	closed: Record<string, unknown>[] = [],
	repoBody: Record<string, unknown> = { allow_auto_merge: false },
	branches: { name: string }[] = [],
): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if (url === `https://api.github.com/repos/${githubRepo}`) {
			return Response.json(repoBody);
		}
		const pullMatch = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${githubRepo}/pulls/(\\d+)$`,
			),
		);
		if (pullMatch !== null) {
			const number = Number(pullMatch[1]);
			const pull = [...pulls, ...closed].find((item) => item.number === number);
			return pull === undefined ? unrecorded(input) : Response.json(pull);
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/issues?`)) {
			return page(issues);
		}
		if (url.startsWith(`https://api.github.com/repos/${githubRepo}/labels?`)) {
			return page([]);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=100&page=1`
		) {
			return page(pulls);
		}
		if (
			url ===
			`https://api.github.com/repos/${githubRepo}/pulls?state=closed&per_page=10&page=1`
		) {
			return page(closed);
		}
		if (url.includes("/branches?")) {
			return page(branches);
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions")
		) {
			return page([]);
		}
		if (url.includes("/check-runs")) {
			return Response.json({ check_runs: [] });
		}
		if (url.includes("/commits/")) {
			return Response.json({
				commit: { committer: { date: "2026-08-18T11:00:00.000Z" } },
			});
		}
		if (url === "https://api.github.com/graphql") {
			const body = typeof init?.body === "string" ? init.body : "";
			const number = body.match(/"number":\s*(\d+)/)?.[1];
			const nodes =
				number === undefined
					? []
					: issues
							.filter((issue) => String(issue.number) === number)
							.map((issue) => ({ number: issue.number }));
			return Response.json({
				data: {
					repository: {
						issue: { closedByPullRequestsReferences: { nodes: [] } },
						pullRequest: { closingIssuesReferences: { nodes } },
					},
				},
			});
		}
		return unrecorded(input);
	};
}

async function withApp(
	config: string,
	fetchImpl: Fetch,
	env: Record<string, string | undefined>,
	check: (base: string) => Promise<void>,
	checkoutRoot?: string,
): Promise<void> {
	const written =
		checkoutRoot === undefined ? config : withCheckout(config, checkoutRoot);
	const { path, cleanup } = await tempConfig(written);
	const root = await mkdtemp(join("/var/tmp", "project-flow-store-"));
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

function withCheckout(config: string, checkoutRoot: string): string {
	const parsed = JSON.parse(config) as Record<string, unknown>;
	return JSON.stringify({ ...parsed, checkoutRoots: [checkoutRoot] });
}

async function projectOf(base: string, name: string): Promise<ProjectBody> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(name)}`, base),
	);
	expect(response.status).toBe(200);
	return (await response.json()) as ProjectBody;
}

function ticketOf(report: ProjectBody, key: string): FlightItem {
	const found = report.sections
		.flatMap((section) => section.items ?? [])
		.find((item) => item.key === key);
	if (found === undefined) {
		throw new Error(`ticket ${key} is missing from the project`);
	}
	return found;
}

function needsYouOf(report: ProjectBody): NeedsYouItem[] {
	return (
		report.sections.find((section) => section.id === "needsYou")?.needsYou ?? []
	);
}

async function git(args: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_DIR: undefined,
			GIT_WORK_TREE: undefined,
			GIT_AUTHOR_NAME: "dev",
			GIT_AUTHOR_EMAIL: "dev@example.com",
			GIT_COMMITTER_NAME: "dev",
			GIT_COMMITTER_EMAIL: "dev@example.com",
		},
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${err || out}`);
	}
	return out;
}

async function devkitWorktree(options: {
	key: string;
	status: "running" | "failed";
	mergeAuto?: "yes" | "ask" | "no";
	repo?: string;
}): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-checkout-"));
	const main = join(root, "acme", "widget");
	const worktree = join(
		root,
		"acme",
		"widget_workspaces",
		`${options.key.replaceAll("/", "-")}-feat`,
	);
	await mkdir(main, { recursive: true });
	await git(["init", "-b", "main"], main);
	await git(["commit", "--allow-empty", "-m", "init"], main);
	const repo = options.repo ?? githubRepo;
	await writeFile(
		join(main, "devkit.toml"),
		`[tracker]\nkind = "github"\n\n[github]\nissues_repo = "${repo}"\n`,
	);
	await writeFile(
		join(main, ".git", "config"),
		`${await readFile(join(main, ".git", "config"), "utf8")}[remote "origin"]\n\turl = https://github.com/${repo}.git\n`,
	);
	await mkdir(join(root, "acme", "widget_workspaces"), { recursive: true });
	await git(["worktree", "add", "-b", "run", worktree], main);
	const issue = await readFile(join(fixtureDir, "issue.toml"), "utf8");
	await mkdir(join(worktree, ".devkit", "workcell"), { recursive: true });
	await writeFile(
		join(worktree, ".devkit", "issue.toml"),
		issue.replace(/^issue = ".*"$/m, `issue = "${options.key}"`),
	);
	await writeFile(
		join(worktree, ".devkit", "workcell", "state.json"),
		await readFile(
			join(
				fixtureDir,
				options.status === "running"
					? "state-running.json"
					: "state-failed.json",
			),
		),
	);
	if (options.mergeAuto !== undefined) {
		const manifest = await readFile(join(fixtureDir, "workcell.toml"), "utf8");
		await mkdir(join(worktree, ".agents"), { recursive: true });
		await writeFile(
			join(worktree, ".agents", "workcell.toml"),
			manifest.replace(/^auto = ".*"$/m, `auto = "${options.mergeAuto}"`),
		);
	}
	const listed = await git(["worktree", "list", "--porcelain"], main);
	if (!listed.includes(worktree)) {
		throw new Error(`worktree list missed ${worktree}: ${listed}`);
	}
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("forward state", () => {
	test("a Linear ticket in Todo with a live workcell run is In progress with a Stale status of Todo", async () => {
		const checkout = await devkitWorktree({ key: "WID-1", status: "running" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-1", "Ship the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 1: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-1")).toMatchObject({
						state: "inProgress",
						lane: "In Progress",
						statusType: "inProgress",
						staleStatus: "Todo",
						chips: ["Todo"],
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a finished review cycle is Awaiting merge and needs you when auto-merge is off or ask", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const cases = [
			{
				auto: "no",
				lane: "Awaiting merge",
				state: "awaitingMerge",
				reason: "awaitingMerge",
			},
			{
				auto: "ask",
				lane: "Awaiting merge",
				state: "awaitingMerge",
				reason: "awaitingMerge",
			},
			{ auto: "yes", lane: "In Review", state: "inReview", reason: null },
		] as const;
		for (const item of cases) {
			const checkout = await devkitWorktree({
				key: "WID-2",
				status: "running",
				mergeAuto: item.auto,
			});
			try {
				await withApp(
					JSON.stringify({
						pinned: [{ tracker: "linear", project: linearSlug }],
					}),
					recordedLinear(
						[
							linearIssue("WID-2", "Land the branch", reviewState, {
								comments: {
									nodes: [
										{
											id: "c1",
											body: progress(
												"- stage 5: round 1 of 3\n- final report sent https://github.com/acme/widget/pull/83",
											),
											createdAt: "2026-08-18T13:00:00.000Z",
										},
									],
									pageInfo: { hasNextPage: false, endCursor: null },
								},
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/83",
											title: "PR 83",
											sourceType: "github",
										},
									],
								},
							}),
						],
						async (input) => {
							const url = urlOf(input);
							if (url === "https://api.github.com/user") {
								return Response.json({ login: "lev" });
							}
							if (
								url === `https://api.github.com/repos/${githubRepo}/pulls/83`
							) {
								return Response.json(
									pullAs(recorded, {
										number: 83,
										body: "Closes WID-2",
										state: "open",
									}),
								);
							}
							if (url.includes("/pulls?state=closed")) {
								return page([]);
							}
							if (
								url.includes("/comments") ||
								url.includes("/reviews") ||
								url.includes("/reactions")
							) {
								return page([]);
							}
							if (url.includes("/check-runs")) {
								return Response.json({ check_runs: [] });
							}
							if (url.includes("/commits/")) {
								return Response.json({
									commit: { committer: { date: "2026-08-18T11:00:00.000Z" } },
								});
							}
							return unrecorded(input);
						},
					),
					{
						LINEAR_API_KEY: "recorded-linear-key",
						GITHUB_TOKEN: "recorded-token",
					},
					async (base) => {
						const report = await projectOf(base, "Widget launch");
						expect(ticketOf(report, "WID-2")).toMatchObject({
							state: item.state,
							lane: item.lane,
						});
						const needs = needsYouOf(report)
							.filter((row) => row.key === "WID-2")
							.map((row) => row.reason);
						expect(needs).toEqual(item.reason === null ? [] : [item.reason]);
					},
					checkout.root,
				);
			} finally {
				await checkout.cleanup();
			}
		}
	});

	test("a merged PR moves its ticket to Done only when the body closes the ticket", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[
					githubIssue(8, { updated_at: "2026-08-18T12:00:00.000Z" }),
					githubIssue(9, { updated_at: "2026-08-18T12:00:00.000Z" }),
				],
				[],
				[
					pullAs(merged, { number: 40, body: "Closes #8", state: "closed" }),
					pullAs(merged, {
						number: 41,
						body: "Partial work for #9",
						state: "closed",
					}),
				],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "done",
					lane: "Done",
					statusType: "done",
				});
				expect(ticketOf(report, `${githubRepo}#9`)).toMatchObject({
					state: "backlog",
					lane: "Backlog",
				});
			},
		);
	});

	test("a Linear ticket in Approved moves to Done when its merged PR closes it", async () => {
		const merged = (await recordedJson(
			"github-pull-merged.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear(
				[
					linearIssue("WID-2", "Land the branch", approvedState, {
						attachments: {
							nodes: [
								{
									url: "https://github.com/acme/widget/pull/83",
									title: merged.title,
									sourceType: "github",
								},
							],
						},
					}),
				],
				async (input) => {
					const url = urlOf(input);
					if (url === "https://api.github.com/user") {
						return Response.json({ login: "lev" });
					}
					if (url === `https://api.github.com/repos/${githubRepo}/pulls/83`) {
						return Response.json(
							pullAs(merged, {
								number: 83,
								body: "Closes WID-2",
								state: "closed",
							}),
						);
					}
					if (url.includes("/pulls?state=closed")) {
						return page([]);
					}
					return unrecorded(input);
				},
			),
			{
				LINEAR_API_KEY: "recorded-linear-key",
				GITHUB_TOKEN: "recorded-token",
			},
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-2")).toMatchObject({
					state: "done",
					lane: "Done",
					statusType: "done",
				});
			},
		);
	});

	test("a failed run returns the ticket to its tracker lane with Run failed and a needs-you item", async () => {
		const checkout = await devkitWorktree({ key: "WID-4", status: "failed" });
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([
					linearIssue("WID-4", "Retry the list", todoState, {
						comments: {
							nodes: [
								{
									id: "c1",
									body: progress("- stage 2: implementing"),
									createdAt: "2026-08-18T13:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					}),
				]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-4")).toMatchObject({
						state: "backlog",
						lane: "Todo",
						statusType: "backlog",
						chips: ["Run failed"],
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === "WID-4")
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a failed run with a pushed branch stays in its tracker lane with Run failed", async () => {
		const checkout = await devkitWorktree({
			key: `${githubRepo}#4`,
			status: "failed",
		});
		try {
			await withApp(
				JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
				recordedRepo(
					[githubIssue(4, { title: "Retry the list" })],
					[],
					[],
					{ allow_auto_merge: false },
					[{ name: "4-feat" }],
				),
				{ GITHUB_TOKEN: "recorded-token" },
				async (base) => {
					const report = await projectOf(base, githubRepo);
					expect(ticketOf(report, `${githubRepo}#4`)).toMatchObject({
						state: "backlog",
						lane: "Backlog",
						chips: ["Run failed"],
					});
					expect(
						needsYouOf(report)
							.filter((row) => row.key === `${githubRepo}#4`)
							.map((row) => row.reason),
					).toEqual(["runFailed"]);
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a blocked ticket stays in its lane with the blocked flag", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear([
				linearIssue("WID-5", "Wait on the schema", progressState, {
					inverseRelations: {
						nodes: [
							{
								type: "blocks",
								issue: {
									identifier: "WID-6",
									title: "Ship the schema",
									state: { type: "unstarted" },
									project: { name: "Widget launch", slugId: linearSlug },
								},
							},
						],
					},
				}),
				linearIssue("WID-6", "Ship the schema", todoState),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-5")).toMatchObject({
					state: "inProgress",
					lane: "In Progress",
					statusType: "inProgress",
					blocked: true,
					chips: ["Blocked"],
				});
			},
		);
	});

	test("a ticket carries the time it entered its state, from tracker history or its last update", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "linear", project: linearSlug }] }),
			recordedLinear([
				linearIssue("WID-7", "Moved yesterday", progressState, {
					history: {
						nodes: [
							{
								...historyNode,
								createdAt: "2026-08-17T09:00:00.000Z",
								toState: { id: todoState.id, name: "Todo", type: "unstarted" },
							},
							historyNode,
						],
					},
				}),
				linearIssue("WID-8", "Never moved", todoState),
			]),
			{ LINEAR_API_KEY: "recorded-linear-key" },
			async (base) => {
				const report = await projectOf(base, "Widget launch");
				expect(ticketOf(report, "WID-7").enteredStateAt).toBe(
					historyNode.createdAt,
				);
				expect(ticketOf(report, "WID-8").enteredStateAt).toBe(
					"2026-08-18T12:00:00.000Z",
				);
			},
		);
	});

	test("a GitHub repo that allows auto-merge keeps a finished review cycle in review", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				expect(
					needsYouOf(report).filter((row) => row.key === `${githubRepo}#8`),
				).toEqual([]);
			},
		);
	});

	test("a configuration auto-merge override of yes keeps a finished review cycle in review", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				autoMerge: { [githubRepo]: "yes" },
			}),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "inReview",
					lane: "In review",
				});
				expect(
					needsYouOf(report).filter((row) => row.key === `${githubRepo}#8`),
				).toEqual([]);
			},
		);
	});

	test("a configuration auto-merge override of no beats a repo that allows auto-merge", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({
				pinned: [{ tracker: "github", repo: githubRepo }],
				autoMerge: { [githubRepo]: "no" },
			}),
			recordedRepo(
				[githubIssue(8)],
				[pullAs(recorded, { number: 40, body: "Closes #8", state: "open" })],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`)).toMatchObject({
					state: "awaitingMerge",
					lane: "Awaiting merge",
				});
				expect(
					needsYouOf(report)
						.filter((row) => row.key === `${githubRepo}#8`)
						.map((row) => row.reason),
				).toEqual(["awaitingMerge"]);
			},
		);
	});

	test("an unlinked PR with finished reviews is not in Needs you when the repo allows auto-merge", async () => {
		const recorded = (await recordedJson(
			"github-pull-auto-merge.json",
		)) as RecordedPull;
		const repo = (await recordedJson("github-repo.json")) as Record<
			string,
			unknown
		>;
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo(
				[],
				[
					pullAs(recorded, {
						number: 90,
						body: "A fix with no ticket.",
						state: "open",
					}),
				],
				[],
				repo,
			),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(needsYouOf(report).map((row) => row.key)).toEqual([]);
			},
		);
	});

	test("a blank workcell status and repeated spaces do not invent a live run", async () => {
		const checkout = await devkitWorktree({ key: "WID-1", status: "running" });
		const statePath = join(
			checkout.root,
			"acme",
			"widget_workspaces",
			"WID-1-feat",
			".devkit",
			"workcell",
			"state.json",
		);
		await writeFile(statePath, JSON.stringify({ status: "  running  " }));
		try {
			await withApp(
				JSON.stringify({
					pinned: [{ tracker: "linear", project: linearSlug }],
				}),
				recordedLinear([linearIssue("WID-1", "Ship the list", todoState)]),
				{ LINEAR_API_KEY: "recorded-linear-key" },
				async (base) => {
					const report = await projectOf(base, "Widget launch");
					expect(ticketOf(report, "WID-1")).toMatchObject({
						state: "backlog",
						lane: "Todo",
					});
				},
				checkout.root,
			);
		} finally {
			await checkout.cleanup();
		}
	});

	test("a GitHub ticket with no tracker history uses its last update", async () => {
		await withApp(
			JSON.stringify({ pinned: [{ tracker: "github", repo: githubRepo }] }),
			recordedRepo([
				githubIssue(8, { updated_at: "2026-08-18T12:00:00.000Z" }),
			]),
			{ GITHUB_TOKEN: "recorded-token" },
			async (base) => {
				const report = await projectOf(base, githubRepo);
				expect(ticketOf(report, `${githubRepo}#8`).enteredStateAt).toBe(
					"2026-08-18T12:00:00.000Z",
				);
			},
		);
	});
});
