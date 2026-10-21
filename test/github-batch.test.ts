import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { NeedsYouItem, Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import {
	linearFake,
	settledOverview,
	tempConfig,
	testIo,
	trackerRequest,
	unrecorded,
} from "./support.ts";

async function readOverview(base: string): Promise<Overview> {
	return (await (
		await fetch(new URL("/api/overview", base))
	).json()) as Overview;
}

const repoCount = 10;
const pullCount = 10;
const repos = Array.from(
	{ length: repoCount },
	(_, index) => `acme/repo-${index}`,
);

type RepoBody = {
	data: {
		repository: {
			nameWithOwner: string;
			autoMergeAllowed: boolean;
			refs: Connection<{ name: string }>;
			labels: Connection<{ name: string; color: string }>;
			issues: Connection<Record<string, unknown>>;
			openPullRequests: Connection<Record<string, unknown>>;
			mergedPullRequests: Connection<Record<string, unknown>>;
		};
		editedIssues?: Connection<Record<string, unknown>>;
	};
};

type Connection<T> = {
	nodes: T[];
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type GraphqlRequest = {
	url: string;
	query: string;
	variables: Record<string, unknown>;
};

const recorded = recordedRepoRead as RepoBody;
const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

function json(body: unknown, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...headers },
	});
}

function operationName(query: string): string | undefined {
	return query.match(/^\s*query\s+(\w+)/)?.[1];
}

function renamed(
	owner: string,
	name: string,
	source: RepoBody = recorded,
): RepoBody {
	const repository = structuredClone(source.data.repository);
	repository.nameWithOwner = `${owner}/${name}`;
	for (const pull of [
		...repository.openPullRequests.nodes,
		...repository.mergedPullRequests.nodes,
	]) {
		const number = pull.number;
		if (typeof number === "number") {
			pull.url = `https://github.com/${owner}/${name}/pull/${number}`;
		}
	}
	return { data: { repository } };
}

function budgetRead(owner: string, name: string): RepoBody {
	const body = renamed(owner, name);
	const sample = body.data.repository.openPullRequests.nodes[0];
	if (sample === undefined) {
		return body;
	}
	body.data.repository.issues.nodes = Array.from(
		{ length: pullCount },
		(_, index) => {
			const issue = structuredClone(body.data.repository.issues.nodes[0] ?? {});
			const number = index + 101;
			issue.number = number;
			issue.title = `Ticket ${number}`;
			return issue;
		},
	);
	body.data.repository.openPullRequests.nodes = Array.from(
		{ length: pullCount },
		(_, index) => {
			const pull = structuredClone(sample);
			const number = index + 1;
			pull.number = number;
			pull.title = `PR ${number}`;
			pull.url = `https://github.com/${owner}/${name}/pull/${number}`;
			pull.body = `Closes #${number + 100}`;
			pull.headRefName = `${number}-feat`;
			const closing = pull.closingIssuesReferences as Connection<{
				number: number;
			}>;
			closing.nodes = [{ number: number + 100 }];
			return pull;
		},
	);
	return body;
}

function graphql(
	input: string | URL | Request,
	init?: RequestInit,
): GraphqlRequest {
	const request = trackerRequest(input, init);
	return request;
}

function membership(
	sent: string[],
	read: (
		owner: string,
		name: string,
		request: GraphqlRequest,
	) => RepoBody | null,
): Fetch {
	return async (input, init) => {
		const request = graphql(input, init);
		sent.push(request.url);
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
		if (url === "https://api.github.com/graphql") {
			const operation = operationName(request.query);
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
			if (operation === "RepoRead") {
				const owner = String(request.variables.owner ?? "");
				const name = String(request.variables.name ?? "");
				const body = read(owner, name, request);
				if (body === null) {
					return json({
						data: { repository: null },
						errors: [{ message: "recorded failure" }],
					});
				}
				return json(body);
			}
			if (operation === "IssueRelations") {
				const answered = read(
					String(request.variables.owner ?? ""),
					String(request.variables.name ?? ""),
					request,
				);
				return json(
					answered ?? {
						data: {
							repository: {
								issue: {
									blockedBy: emptyPage,
									blocking: emptyPage,
									labels: emptyPage,
								},
							},
						},
					},
				);
			}
			if (operation === "NestedReview" || operation === "IssueComments") {
				const answered = read(
					String(request.variables.owner ?? ""),
					String(request.variables.name ?? ""),
					request,
				);
				if (answered !== null && operation === "NestedReview") {
					const pull = answered.data.repository.openPullRequests.nodes[0];
					return json({
						data: {
							repository: {
								pullRequest: {
									reviews: pull?.reviews ?? emptyPage,
									comments: emptyPage,
									reactions: emptyPage,
									closingIssuesReferences: emptyPage,
									statusCheckRollup: { contexts: emptyPage },
								},
							},
						},
					});
				}
				return json({
					data: {
						repository: {
							pullRequest: {
								reviews: emptyPage,
								comments: emptyPage,
								reactions: emptyPage,
								closingIssuesReferences: emptyPage,
								statusCheckRollup: { contexts: emptyPage },
							},
							issue: { comments: emptyPage },
						},
					},
				});
			}
			return json({ data: { node: { fields: { nodes: [{}] } } } });
		}
		if (url === "https://api.linear.app/graphql") {
			const operation = operationName(request.query);
			if (operation === "MemberProjects") {
				return json({
					data: { viewer: { id: "lev" }, projects: emptyPage },
				});
			}
			return json({ data: { viewer: { id: "lev" } } });
		}
		return unrecorded(input);
	};
}

async function startCounted(
	body: string,
	read: (
		owner: string,
		name: string,
		request: GraphqlRequest,
	) => RepoBody | null,
	hold?: { release: () => void; held: Promise<void> },
): Promise<{
	overview: Overview;
	needsYou: NeedsYouItem[];
	github: string[];
	queries: GraphqlRequest[];
	base: string;
}> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
	const { path, cleanup } = await tempConfig(body);
	const sent: string[] = [];
	const queries: GraphqlRequest[] = [];
	const fetchImpl = membership(sent, (owner, name, request) => {
		if (operationName(request.query) === "RepoRead") {
			queries.push(request);
		}
		return read(owner, name, request);
	});
	let startChecks: (base: string) => void = () => {};
	const checked = new Promise<{ overview: Overview; needsYou: NeedsYouItem[] }>(
		(resolve, reject) => {
			startChecks = (base) => {
				const ready = hold?.held ?? Promise.resolve();
				ready
					.then(() =>
						Promise.all([
							fetch(new URL("/api/overview", base)).then(
								(response) => response.json() as Promise<Overview>,
							),
							fetch(new URL("/api/needs-you", base)).then(
								(response) => response.json() as Promise<NeedsYouItem[]>,
							),
						]),
					)
					.then(
						([overview, needsYou]) => resolve({ overview, needsYou }),
						reject,
					);
			};
		},
	);
	try {
		const result = await run(
			["--config", path, "--host", "127.0.0.1", "--port", "0"],
			testIo({
				env: {
					GITHUB_TOKEN: "recorded-token",
					LINEAR_API_KEY: "recorded-linear-key",
				},
				fetch: async (input, init) => {
					if (hold !== undefined) {
						await hold.held;
					}
					return fetchImpl(input, init);
				},
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checked.then(() => undefined),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		const ready = await checked;
		return {
			...ready,
			base: "",
			github: sent.filter((url) => url.startsWith("https://api.github.com/")),
			queries,
		};
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("batched GitHub reads", () => {
	test("a start with 10 tracked repos of 10 open PRs sends at most 25 GitHub requests", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github, overview, needsYou } = await startCounted(
			JSON.stringify({ tracked }),
			(owner, name) => budgetRead(owner, name),
		);
		expect(github.length).toBeLessThanOrEqual(25);
		expect(github.filter((url) => url.includes("/pulls/")).length).toBe(0);
		expect(github.filter((url) => url.endsWith("/graphql")).length).toBe(11);
		const project = overview.projects.find(
			(item) => item.name === "acme/repo-0",
		);
		expect(
			project?.tickets.find((ticket) => ticket.key === "acme/repo-0#101")
				?.state,
		).toBe("awaitingMerge");
		expect(
			needsYou.find((item) => item.key === "acme/repo-0#101")?.pull?.ci,
		).toBe("passing");
	});

	test("a blank tracked repo fails before any GitHub request", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "   " }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(
				sent.filter((url) => url.startsWith("https://api.github.com/")),
			).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a repo name with repeated spaces fails before any GitHub request", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme  repo" }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(
				sent.filter((url) => url.startsWith("https://api.github.com/")),
			).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a GraphQL error on RepoRead fails the start", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/repo-0" }] }),
		);
		const sent: string[] = [];
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: membership(sent, () => null),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("GitHub read repo failed");
			expect(sent.filter((url) => url.includes("/issues?"))).toEqual([]);
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the overview shows the recorded GraphQL review, check and reaction state", async () => {
		const { overview, needsYou } = await startCounted(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
			(owner, name) => renamed(owner, name),
		);
		const project = overview.projects.find(
			(item) => item.name === "acme/widget",
		);
		expect(
			(project?.tickets ?? []).flatMap((ticket) =>
				ticket.key === null ? [] : [[ticket.key, ticket.state] as const],
			),
		).toEqual([
			["acme/widget#101", "awaitingMerge"],
			["acme/widget#102", "inReview"],
		]);
		expect(
			needsYou.map((item) => ({
				key: item.key,
				ci: item.pull?.ci,
				review: item.pull?.review,
			})),
		).toEqual([
			{
				key: "acme/widget#101",
				ci: "passing",
				review: "completed",
			},
		]);
	});

	test("a refresh after a failed poll reads GitHub again and a later refresh reads the new title", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let reads = 0;
		let failNext = false;
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (operationName(request.query) !== "RepoRead") {
							return renamed(owner, name);
						}
						queries.push(request);
						reads += 1;
						if (failNext) {
							failNext = false;
							return null;
						}
						const body = renamed(owner, name);
						const issue = body.data.repository.issues.nodes[0];
						if (issue !== undefined && reads > 2) {
							issue.title = "Recovered ticket";
						}
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						const wait = async () => {
							while (true) {
								const response = await fetch(
									new URL("/api/overview", line),
								).catch(() => null);
								if (response?.ok === true) {
									releaseReady();
									return;
								}
								await Bun.sleep(20);
							}
						};
						void wait();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const first = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(first.error).toBeNull();
			failNext = true;
			const failedRefresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(failedRefresh.status).toBe(204);
			const failed = await settledOverview(base, readOverview);
			expect(failed.projects[0]?.error).toContain("GitHub read repo failed");
			expect(failed.projects[0]?.tickets).toHaveLength(2);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const recovered = await settledOverview(base, readOverview);
			expect(recovered.error).toBeNull();
			expect(recovered.projects[0]?.tickets).toHaveLength(2);
			const again = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(again.status).toBe(204);
			const updated = await settledOverview(base, readOverview);
			expect(updated.projects[0]?.tickets[0]?.title).toBe("Recovered ticket");
			expect(queries.length).toBeGreaterThanOrEqual(3);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an unused label page still completes the factory lanes", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						const body = renamed(owner, name);
						if (operationName(request.query) !== "RepoRead") {
							return body;
						}
						queries.push(request);
						body.data.repository.issues.nodes = [
							{
								...(body.data.repository.issues.nodes[0] ?? {}),
								number: 7,
								title: "Queue the job",
								labels: {
									nodes: [{ name: "ready", color: "0E8A16" }],
									pageInfo: emptyPage.pageInfo,
								},
							},
						];
						body.data.repository.openPullRequests.nodes = [];
						body.data.repository.mergedPullRequests.nodes = [];
						const labels = body.data.repository.labels;
						if (request.variables.afterLabels === null) {
							labels.nodes = [
								{ name: "ready", color: "0E8A16" },
								{ name: "unused", color: "FFFFFF" },
							];
							labels.pageInfo = { hasNextPage: true, endCursor: "label-2" };
							return body;
						}
						labels.nodes = [
							{ name: "factory: running", color: "1D76DB" },
							{ name: "factory: in-review", color: "FBCA04" },
						];
						labels.pageInfo = { hasNextPage: false, endCursor: null };
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const report = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { lanes: { name: string; colour: string }[] };
			expect(report.lanes.map((lane) => lane.name)).toContain("ready");
			expect(report.lanes.map((lane) => lane.name)).toContain(
				"factory: in-review",
			);
			expect(report.lanes.find((lane) => lane.name === "ready")?.colour).toBe(
				"#0E8A16",
			);
			expect(queries.map((request) => request.variables.afterLabels)).toEqual([
				null,
				"label-2",
			]);
			expect(queries[1]?.query.includes("openPullRequests")).toBe(false);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a review on a later page reaches the overview", async () => {
		const { github, needsYou } = await startCounted(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
			}),
			(owner, name, request) => {
				const body = renamed(owner, name);
				const pull = body.data.repository.openPullRequests.nodes[0];
				const reviews = pull?.reviews as
					| Connection<Record<string, unknown>>
					| undefined;
				if (reviews === undefined) {
					return body;
				}
				if (operationName(request.query) === "NestedReview") {
					reviews.pageInfo = { hasNextPage: false, endCursor: null };
					return body;
				}
				reviews.pageInfo = { hasNextPage: true, endCursor: "review-2" };
				reviews.nodes = [];
				return body;
			},
		);
		expect(github.filter((url) => url.endsWith("/graphql")).length).toBe(3);
		expect(
			needsYou.find((item) => item.key === "acme/widget#101")?.pull?.review,
		).toBe("completed");
	});

	test("an edited comment on an unchanged issue reaches the next incremental poll", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		const progress = "**Workcell progress**\n- stage 2: implementing";
		try {
			let base = "";
			let ticks = 0;
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						const body = renamed(owner, name);
						if (operationName(request.query) !== "RepoRead") {
							return body;
						}
						queries.push(request);
						const since = request.variables.since;
						const issue = body.data.repository.issues.nodes[0];
						if (issue === undefined) {
							return body;
						}
						issue.updatedAt = "2026-04-01T08:00:00.000Z";
						issue.comments = {
							nodes:
								since === null
									? [
											{
												databaseId: 1,
												body: progress,
												createdAt: "2026-04-01T10:04:00.000Z",
												updatedAt: "2026-04-01T10:04:00.000Z",
												author: { login: "ada" },
												reactions: { totalCount: 0 },
											},
										]
									: [],
							pageInfo: emptyPage.pageInfo,
						};
						if (since !== null) {
							body.data.repository.issues.nodes = [];
							body.data.editedIssues = {
								nodes: [
									{
										...issue,
										comments: {
											nodes: [
												{
													databaseId: 1,
													body: `${progress}\n- stage 4: implementing`,
													createdAt: "2026-04-01T10:04:00.000Z",
													updatedAt: "2026-04-01T12:05:10.000Z",
													author: { login: "ada" },
													reactions: { totalCount: 0 },
												},
											],
											pageInfo: emptyPage.pageInfo,
										},
									},
								],
								pageInfo: emptyPage.pageInfo,
							};
						}
						body.data.repository.openPullRequests.nodes = [];
						body.data.repository.mergedPullRequests.nodes = [];
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () =>
						new Date(Date.parse("2026-04-01T12:00:00.000Z") + ticks++ * 1_000),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const first = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { tickets: { run?: { stage?: string } }[] };
			expect(first.tickets[0]?.run?.stage).toBe("stage 2");
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview);
			const second = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as { tickets: { run?: { stage?: string } }[] };
			expect(second.tickets[0]?.run?.stage).toBe("stage 4");
			expect(
				queries.some((request) => request.query.includes("editedIssues")),
			).toBe(true);
			expect(
				queries.filter((request) => request.variables.since !== null).length,
			).toBeGreaterThan(0);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a merged pull keeps its head SHA and an empty closing set", async () => {
		const head = "b".repeat(40);
		const { overview, needsYou } = await startCounted(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				expectedBots: { "acme/widget": ["grok"] },
			}),
			(owner, name) => {
				const body = renamed(owner, name);
				const open = structuredClone(
					body.data.repository.openPullRequests.nodes[0],
				);
				const merged = body.data.repository.mergedPullRequests.nodes[0];
				if (open !== undefined) {
					open.number = 3;
					open.headRefOid = head;
					open.body = "";
					open.closingIssuesReferences = {
						nodes: [],
						pageInfo: emptyPage.pageInfo,
					};
					open.reviews = {
						nodes: [
							{
								author: { login: "grok-code-review[bot]" },
								commit: { oid: head },
								state: "APPROVED",
							},
						],
						pageInfo: emptyPage.pageInfo,
					};
				}
				body.data.repository.openPullRequests.nodes =
					open === undefined ? [] : [open];
				if (merged !== undefined) {
					merged.headRefOid = head;
					merged.body = "Closes #101";
					merged.closingIssuesReferences = {
						nodes: [{ number: 101 }],
						pageInfo: emptyPage.pageInfo,
					};
					merged.reviews = open?.reviews ?? merged.reviews;
				}
				body.data.repository.issues.nodes = [];
				return body;
			},
		);
		expect(overview.projects[0]?.done).toBe(0);
		expect(
			overview.projects[0]?.unlinkedPrs.map((pull) => pull.number),
		).toEqual([3]);
		expect(needsYou.find((item) => item.pull?.number === 3)?.pull?.review).toBe(
			"approved",
		);
	});

	test("a GraphQL NOT_PLANNED issue sits in Dropped", async () => {
		const { overview } = await startCounted(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
			(owner, name) => {
				const body = renamed(owner, name);
				const closed = body.data.repository.issues.nodes[0];
				if (closed !== undefined) {
					closed.number = 12;
					closed.title = "Not planned";
					closed.state = "CLOSED";
					closed.stateReason = "NOT_PLANNED";
				}
				body.data.repository.issues.nodes =
					closed === undefined ? [] : [closed];
				body.data.repository.openPullRequests.nodes = [];
				body.data.repository.mergedPullRequests.nodes = [];
				return body;
			},
		);
		const project = overview.projects.find(
			(item) => item.name === "acme/widget",
		);
		expect(
			project?.tickets.find((ticket) => ticket.key === "acme/widget#12"),
		).toEqual(
			expect.objectContaining({ lane: "Dropped", statusType: "dropped" }),
		);
		expect(project?.statusTypes.dropped).toBe(1);
		expect(project?.statusTypes.done).toBe(0);
	});

	test("an incremental refresh shares one repository snapshot", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (operationName(request.query) !== "RepoRead") {
							return renamed(owner, name);
						}
						queries.push(request);
						const body = renamed(owner, name);
						const issues = body.data.repository.issues;
						if (request.variables.since != null) {
							const issue = issues.nodes[0];
							issues.nodes = issue === undefined ? [] : [issue];
							issues.pageInfo = { hasNextPage: false, endCursor: null };
							return body;
						}
						if (request.variables.afterIssues != null) {
							const issue = structuredClone(issues.nodes[0] ?? {});
							issue.number = 200;
							issue.updatedAt = "2026-01-01T00:00:00.000Z";
							issues.nodes = [issue];
							issues.pageInfo = { hasNextPage: false, endCursor: null };
							return body;
						}
						issues.pageInfo = { hasNextPage: true, endCursor: "issue-2" };
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const before = queries.length;
			expect(
				queries
					.slice(0, before)
					.some((request) => request.variables.afterIssues != null),
			).toBe(true);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			await settledOverview(base, readOverview);
			const incremental = queries.slice(before);
			expect(incremental.map((request) => request.variables.since)).toEqual([
				"2026-08-18T12:00:00.000Z",
			]);
			expect(
				incremental.map((request) => request.variables.afterIssues),
			).toEqual([null]);
			expect(
				incremental.every((request) => request.query.includes("issues(")),
			).toBe(true);
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(
				overview.projects
					.find((item) => item.name === "acme/widget")
					?.tickets.map((ticket) => ticket.key)
					.sort(),
			).toEqual(["acme/widget#101", "acme/widget#102", "acme/widget#200"]);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a later issue blocker, blocking link and label reach the overview", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({ tracked: [{ tracker: "github", repo: "acme/widget" }] }),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		const read = (
			owner: string,
			name: string,
			request: GraphqlRequest,
		): RepoBody | null => {
			const body = renamed(owner, name);
			const issue = body.data.repository.issues.nodes[0];
			if (issue === undefined) {
				return body;
			}
			issue.state = "OPEN";
			const connection = (
				nodes: Record<string, unknown>[],
				cursor: string | null,
			) => ({
				nodes,
				pageInfo: {
					hasNextPage: cursor !== null,
					endCursor: cursor,
				},
			});
			if (operationName(request.query) === "RepoRead") {
				const labels = body.data.repository.labels;
				if (request.variables.afterLabels == null) {
					labels.nodes = [];
					labels.pageInfo = { hasNextPage: true, endCursor: "label-2" };
				} else {
					labels.nodes = [
						{ name: "ready", color: "0E8A16" },
						{ name: "factory: running", color: "1D76DB" },
						{ name: "factory: in-review", color: "FBCA04" },
					];
					labels.pageInfo = { hasNextPage: false, endCursor: null };
				}
			}
			if (operationName(request.query) === "IssueRelations") {
				return {
					data: {
						repository: {
							nameWithOwner: `${owner}/${name}`,
							issue: {
								blockedBy: connection(
									[
										{
											number: 40,
											title: "Later blocker",
											state: "OPEN",
											repository: { nameWithOwner: `${owner}/${name}` },
										},
									],
									null,
								),
								blocking: connection(
									[
										{
											number: 41,
											title: "Later blocked",
											state: "OPEN",
											repository: { nameWithOwner: "acme/other" },
										},
									],
									null,
								),
								labels: connection(
									[{ name: "later-label", color: "ededed" }],
									null,
								),
							},
						},
					},
				} as unknown as RepoBody;
			}
			issue.blockedBy = connection([], "blocked-2");
			issue.blocking = connection([], "blocking-2");
			issue.labels = connection([], "labels-2");
			body.data.repository.issues.nodes = [issue];
			body.data.repository.openPullRequests.nodes = [];
			body.data.repository.mergedPullRequests.nodes = [];
			return body;
		};
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (request.query !== "") {
							queries.push(request);
						}
						return read(owner, name, request);
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			const report = (await (
				await fetch(new URL("/api/projects/acme%2Fwidget", base))
			).json()) as {
				lanes: { name: string }[];
				tickets: {
					key: string | null;
					blockers: string[];
					blocked?: boolean;
					lane?: string;
				}[];
			};
			const ticket = report.tickets.find(
				(item) => item.key === "acme/widget#101",
			);
			expect(ticket?.blockers).toEqual(["acme/widget#40"]);
			expect(ticket?.blocked).toBe(true);
			expect(report.lanes.map((lane) => lane.name)).toContain(
				"factory: running",
			);
			expect(report.tickets[0]?.lane).toBe("factory: running");
			expect(
				queries.some((request) => request.query.includes("IssueRelations")),
			).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("auto-merge metadata for an unreadable pull repo does not fail the Linear poll", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: linearFake({
						issues: [
							{
								identifier: "WID-1",
								title: "Ship the list",
								description: "",
								updatedAt: "2026-08-18T12:00:00.000Z",
								state: {
									id: "st-done",
									name: "Done",
									type: "completed",
									color: "#4CB782",
								},
								attachments: {
									nodes: [
										{
											url: "https://github.com/acme/widget/pull/7",
											title: "fix: ship the list",
											sourceType: "github",
										},
									],
								},
							},
						],
						github: async (input, init) => {
							const request = graphql(input, init);
							if (operationName(request.query) === "RepoRead") {
								queries.push(request);
								if (!request.query.includes("issues(")) {
									return json({
										data: { repository: null },
										errors: [{ message: "recorded failure" }],
									});
								}
								return json(renamed("acme", "widget"));
							}
							const url = request.url;
							if (url === "https://api.github.com/user") {
								return json({ login: "lev" });
							}
							if (url === "https://api.github.com/repos/acme/widget/pulls/7") {
								return json({
									number: 7,
									title: "fix: ship the list",
									html_url: "https://github.com/acme/widget/pull/7",
									draft: false,
									body: "Closes WID-1",
									head: { ref: "7-feat", sha: "a".repeat(40) },
									state: "open",
									merged_at: null,
								});
							}
							if (
								url.includes("/pulls?") ||
								url.includes("/reviews") ||
								url.includes("/comments") ||
								url.includes("/reactions") ||
								url.includes("/check-runs") ||
								url.includes("/commits/")
							) {
								return json(
									url.includes("/check-runs") ? { check_runs: [] } : [],
								);
							}
							return membership([], () => null)(input, init);
						},
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			const started = await Promise.race([
				ready.then(() => "ready" as const),
				running.then((finished) => finished),
			]);
			if (started !== "ready") {
				expect(started.stderr).toBe("");
				expect(started.exitCode).toBe(0);
			}
			const overview = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			const project = overview.projects.find(
				(item) => item.name === "Widget launch",
			);
			expect(project?.error).toBeNull();
			expect(project?.tickets.map((ticket) => ticket.key)).toEqual(["WID-1"]);
			const metadata = queries.filter(
				(request) => !request.query.includes("issues("),
			);
			expect(metadata).toHaveLength(1);
			expect(metadata[0]?.query.includes("autoMergeAllowed")).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("auto-merge metadata for an unreadable repository does not fail the poll", async () => {
		const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
		const { path, cleanup } = await tempConfig(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/widget" }],
				pollIntervalSeconds: 3600,
			}),
		);
		const queries: GraphqlRequest[] = [];
		let failRead = false;
		let releaseReady: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			releaseReady = resolve;
		});
		let stop = () => {};
		const stopped = new Promise<void>((resolve) => {
			stop = resolve;
		});
		try {
			let base = "";
			const running = run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: { GITHUB_TOKEN: "recorded-token" },
					fetch: membership([], (owner, name, request) => {
						if (operationName(request.query) !== "RepoRead") {
							return renamed(owner, name);
						}
						queries.push(request);
						const body = renamed(owner, name);
						if (failRead) {
							body.data.repository.autoMergeAllowed = null as never;
						}
						return body;
					}),
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: (line) => {
						base = line;
						releaseReady();
					},
					waitForStop: stopped,
				}),
			);
			await ready;
			failRead = true;
			const before = queries.length;
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const overview = await settledOverview(base, readOverview);
			const project = overview.projects.find(
				(item) => item.name === "acme/widget",
			);
			expect(project?.error).toBeNull();
			expect(project?.tickets.map((ticket) => ticket.key).sort()).toEqual([
				"acme/widget#101",
				"acme/widget#102",
			]);
			const later = queries.slice(before);
			expect(later).toHaveLength(1);
			expect(later[0]?.query.includes("issues(")).toBe(true);
			expect(later[0]?.query.includes("autoMergeAllowed")).toBe(true);
			stop();
			await running;
		} finally {
			stop();
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a start with 10 tracked repos of 10 open PRs stays within 25 requests when nested pages are empty", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github } = await startCounted(
			JSON.stringify({ tracked }),
			(owner, name) => budgetRead(owner, name),
		);
		expect(github.length).toBeLessThanOrEqual(25);
	});
});
