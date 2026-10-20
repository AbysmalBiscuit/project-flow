import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { NeedsYouItem, Overview } from "../src/domain.ts";
import type { Fetch } from "../src/fetch.ts";
import { run } from "../src/main.ts";
import { tempConfig, testIo, trackerRequest, unrecorded } from "./support.ts";

const repoCount = 10;
const pullCount = 10;
const repos = Array.from(
	{ length: repoCount },
	(_, index) => `acme/repo-${index}`,
);

function json(body: unknown, headers?: HeadersInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...headers },
	});
}

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

function operationName(query: string): string | undefined {
	return query.match(/^\s*query\s*(?:(\w+)|\{\s*(\w+))/)?.[1];
}

type RecordedReview = {
	login: string;
	commitId: string;
	state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
};

type RecordedCheck = {
	name: string;
	status: string;
	conclusion: string | null;
};

type RecordedReaction = {
	login: string;
	content: string;
	createdAt: string;
};

const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const grok = "grok-code-review[bot]";
const recordedReview: RecordedReview = {
	login: grok,
	commitId: head,
	state: "COMMENTED",
};
const recordedCheck: RecordedCheck = {
	name: "Grok code review",
	status: "completed",
	conclusion: "success",
};
const recordedReaction: RecordedReaction = {
	login: grok,
	content: "eyes",
	createdAt: "2026-08-18T11:00:00Z",
};

function repoRead(owner: string, name: string) {
	const pulls = Array.from({ length: pullCount }, (_, index) => {
		const number = index + 1;
		return {
			number,
			title: `PR ${number}`,
			url: `https://github.com/${owner}/${name}/pull/${number}`,
			isDraft: false,
			body: `Closes #${number + 100}`,
			state: "OPEN",
			mergedAt: null,
			headRefName: `${number}-feat`,
			headRefOid: head,
			autoMergeRequest: null,
			commits: {
				nodes: [
					{
						commit: {
							oid: head,
							committedDate: "2026-08-18T10:00:00Z",
							statusCheckRollup: {
								contexts: {
									nodes: [
										{
											__typename: "CheckRun",
											name: recordedCheck.name,
											status: "COMPLETED",
											conclusion: "SUCCESS",
										},
									],
								},
							},
						},
					},
				],
			},
			closingIssuesReferences: {
				nodes: [{ number: number + 100 }],
			},
			reviews: {
				nodes: [
					{
						author: { login: recordedReview.login },
						commit: { oid: recordedReview.commitId },
						state: recordedReview.state,
					},
				],
			},
			comments: {
				nodes: [
					{
						author: { login: grok },
						body: "<!-- workcell:ask lane -->\n@Lev which lane?\n1. Keep\n2. Drop",
						createdAt: "2026-08-18T11:30:00Z",
						reactions: { totalCount: 1 },
					},
				],
			},
			reactions: {
				nodes: [
					{
						user: { login: recordedReaction.login },
						content: "EYES",
						createdAt: recordedReaction.createdAt,
					},
				],
			},
		};
	});
	const issues = Array.from({ length: pullCount }, (_, index) => {
		const number = index + 101;
		return {
			number,
			title: `Ticket ${number}`,
			state: "OPEN",
			stateReason: null,
			updatedAt: "2026-08-18T12:00:00Z",
			createdAt: "2026-08-01T12:00:00Z",
			closedAt: null,
			body: "",
			comments: { nodes: [] },
			labels: { nodes: [] },
			assignees: { nodes: [] },
			milestone: null,
			parent: null,
		};
	});
	const merged = [
		{
			number: 90,
			title: "merged",
			url: `https://github.com/${owner}/${name}/pull/90`,
			isDraft: false,
			body: "Closes #1",
			state: "MERGED",
			mergedAt: "2026-08-01T12:00:00Z",
			headRefName: "merged",
			headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			autoMergeRequest: null,
			commits: { nodes: [] },
			closingIssuesReferences: { nodes: [] },
			reviews: {
				nodes: [
					{
						author: { login: recordedReview.login },
						commit: { oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
						state: "COMMENTED",
					},
				],
			},
			comments: { nodes: [] },
			reactions: { nodes: [] },
			statusCheckRollup: {
				contexts: {
					nodes: [
						{
							__typename: "CheckRun",
							name: recordedCheck.name,
							status: "COMPLETED",
							conclusion: "SUCCESS",
						},
					],
				},
			},
		},
	];
	return {
		nameWithOwner: `${owner}/${name}`,
		autoMergeAllowed: false,
		refs: emptyPage,
		issues: { nodes: issues, pageInfo: emptyPage.pageInfo },
		openPullRequests: { nodes: pulls, pageInfo: emptyPage.pageInfo },
		mergedPullRequests: { nodes: merged, pageInfo: emptyPage.pageInfo },
	};
}

function parityRead(owner: string, name: string) {
	const codex = "chatgpt-codex-connector[bot]";
	const check = {
		__typename: "CheckRun",
		name: recordedCheck.name,
		status: "COMPLETED",
		conclusion: "SUCCESS",
	};
	const pull = (number: number, reaction: "THUMBS_UP" | "EYES") => ({
		number,
		title: `PR ${number}`,
		url: `https://github.com/${owner}/${name}/pull/${number}`,
		isDraft: false,
		body: `Closes #${number + 100}`,
		state: "OPEN",
		mergedAt: null,
		headRefName: `${number}-feat`,
		headRefOid: head,
		autoMergeRequest: null,
		commits: {
			nodes: [{ commit: { committedDate: "2026-08-18T10:00:00Z" } }],
		},
		closingIssuesReferences: { nodes: [{ number: number + 100 }] },
		reviews: {
			nodes: [
				{
					author: { login: grok },
					commit: { oid: head },
					state: "COMMENTED",
				},
			],
		},
		comments: { nodes: [] },
		reactions: {
			nodes: [
				{
					user: { login: codex },
					content: reaction,
					createdAt: "2026-08-18T11:00:00Z",
				},
			],
		},
		statusCheckRollup: { contexts: { nodes: [check] } },
	});
	return {
		nameWithOwner: `${owner}/${name}`,
		autoMergeAllowed: false,
		refs: emptyPage,
		issues: {
			nodes: [101, 102].map((number) => ({
				number,
				title: `Ticket ${number}`,
				state: "OPEN",
				stateReason: null,
				updatedAt: "2026-08-18T12:00:00Z",
				createdAt: "2026-08-01T12:00:00Z",
				closedAt: null,
				body: "",
				comments: { nodes: [] },
				labels: { nodes: [] },
				assignees: { nodes: [] },
				milestone: null,
				parent: null,
			})),
			pageInfo: emptyPage.pageInfo,
		},
		openPullRequests: {
			nodes: [pull(1, "THUMBS_UP"), pull(2, "EYES")],
			pageInfo: emptyPage.pageInfo,
		},
		mergedPullRequests: {
			nodes: [
				{
					number: 90,
					title: "merged",
					url: `https://github.com/${owner}/${name}/pull/90`,
					isDraft: false,
					body: "",
					state: "MERGED",
					mergedAt: "2026-08-01T12:00:00Z",
					headRefName: "merged",
					headRefOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
					autoMergeRequest: null,
					commits: { nodes: [] },
					closingIssuesReferences: { nodes: [] },
					reviews: {
						nodes: [
							{
								author: { login: grok },
								commit: { oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
								state: "COMMENTED",
							},
						],
					},
					comments: { nodes: [] },
					reactions: {
						nodes: [
							{
								user: { login: codex },
								content: "THUMBS_UP",
								createdAt: "2026-08-01T11:00:00Z",
							},
						],
					},
					statusCheckRollup: { contexts: { nodes: [check] } },
				},
			],
			pageInfo: emptyPage.pageInfo,
		},
	};
}

function membership(sent: string[], parity = false): Fetch {
	return async (input, init) => {
		const request = trackerRequest(input, init);
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
				return json({
					data: {
						repository:
							parity && `${owner}/${name}` === "acme/repo-0"
								? parityRead(owner, name)
								: repoRead(owner, name),
					},
				});
			}
			return json({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
						issue: { closedByPullRequestsReferences: { nodes: [] } },
					},
					node: { fields: { nodes: [{}] } },
				},
			});
		}
		if (url === "https://api.linear.app/graphql") {
			const operation = operationName(request.query);
			if (operation === "MemberProjects") {
				return json({
					data: {
						viewer: { id: "lev" },
						projects: emptyPage,
					},
				});
			}
			return json({ data: { viewer: { id: "lev" } } });
		}
		return unrecorded(input);
	};
}

async function startCounted(
	body: string,
	parity = false,
): Promise<{
	base: string;
	overview: Overview;
	needsYou: NeedsYouItem[];
	github: string[];
}> {
	const root = await mkdtemp(join("/var/tmp", "project-flow-batch-"));
	const { path, cleanup } = await tempConfig(body);
	const sent: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checked = new Promise<{ overview: Overview; needsYou: NeedsYouItem[] }>(
		(resolve, reject) => {
			startChecks = (base) => {
				Promise.all([
					fetch(new URL("/api/overview", base)).then(
						(response) => response.json() as Promise<Overview>,
					),
					fetch(new URL("/api/needs-you", base)).then(
						(response) => response.json() as Promise<NeedsYouItem[]>,
					),
				]).then(
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
				fetch: membership(sent, parity),
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
		};
	} finally {
		await cleanup();
		await rm(root, { recursive: true, force: true });
	}
}

describe("batched GitHub reads", () => {
	test("a start with 10 tracked repos of 10 open PRs sends at most 25 GitHub requests", async () => {
		const tracked = repos.map((repo) => ({ tracker: "github", repo }));
		const { github } = await startCounted(JSON.stringify({ tracked }));
		expect(github.length).toBeLessThanOrEqual(25);
		expect(github.filter((url) => url.includes("/pulls/")).length).toBe(0);
		expect(github.filter((url) => url.endsWith("/graphql")).length).toBe(11);
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
					fetch: membership(sent),
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
					fetch: membership(sent),
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
		const fetchImpl = membership(sent);
		const failing: Fetch = async (input, init) => {
			const request = trackerRequest(input, init);
			if (
				request.url === "https://api.github.com/graphql" &&
				operationName(request.query) === "RepoRead"
			) {
				sent.push(request.url);
				return json({
					data: { repository: null },
					errors: [{ message: "something went wrong" }],
				});
			}
			return fetchImpl(input, init);
		};
		try {
			const result = await run(
				["--config", path, "--host", "127.0.0.1", "--port", "0"],
				testIo({
					env: {
						GITHUB_TOKEN: "recorded-token",
						LINEAR_API_KEY: "recorded-linear-key",
					},
					fetch: failing,
					readGhToken: async () => null,
					databasePath: join(root, "project-flow.sqlite"),
					now: () => new Date("2026-08-18T12:00:00.000Z"),
					stdout: () => {},
					waitForStop: new Promise(() => {}),
				}),
			);
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("GitHub read repo failed");
		} finally {
			await cleanup();
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the overview shows the recorded GraphQL review, check and reaction state", async () => {
		const { overview, needsYou } = await startCounted(
			JSON.stringify({
				tracked: [{ tracker: "github", repo: "acme/repo-0" }],
			}),
			true,
		);
		const project = overview.projects.find(
			(item) => item.name === "acme/repo-0",
		);
		expect(
			(project?.tickets ?? []).flatMap((ticket) =>
				ticket.key === null ? [] : [[ticket.key, ticket.state] as const],
			),
		).toEqual([
			["acme/repo-0#101", "awaitingMerge"],
			["acme/repo-0#102", "inReview"],
		]);
		expect(
			needsYou.map((item) => ({
				key: item.key,
				ci: item.pull?.ci,
				review: item.pull?.review,
			})),
		).toEqual([
			{
				key: "acme/repo-0#101",
				ci: "passing",
				review: "completed",
			},
		]);
	});
});
