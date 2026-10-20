import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { NeedsYouItem, Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import recordedRepoRead from "./fixtures/github-repo-read.json";
import { tempConfig, testIo, trackerRequest, unrecorded } from "./support.ts";

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
							const deadline = Date.now() + 3_000;
							while (Date.now() < deadline) {
								const response = await fetch(
									new URL("/api/overview", line),
								).catch(() => null);
								if (response?.ok === true) {
									releaseReady();
									return;
								}
							}
							releaseReady();
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
			const failed = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(failed.projects[0]?.error).toContain("GitHub read repo failed");
			expect(failed.projects[0]?.tickets).toHaveLength(2);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			const recovered = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
			expect(recovered.error).toBeNull();
			expect(recovered.projects[0]?.tickets).toHaveLength(2);
			const again = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(again.status).toBe(204);
			const updated = (await (
				await fetch(new URL("/api/overview", base))
			).json()) as Overview;
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

	test("a start with 10 tracked repos of 10 open PRs stays within 25 requests when nested pages are empty", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github } = await startCounted(
			JSON.stringify({ tracked }),
			(owner, name) => budgetRead(owner, name),
		);
		expect(github.length).toBeLessThanOrEqual(25);
	});
});
