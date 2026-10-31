import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import type { LocalCheckout } from "../../src/ports.ts";
import { tempConfig, testIo } from "../support/app.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import {
	githubIssueNode,
	repoReadIssues,
	repoReadResponse,
} from "../support/repo-read.ts";

export const shown = "acme/shown";
export const quiet = "acme/quiet";

function issue(
	number: number,
	updatedAt: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		html_url: `https://github.com/${shown}/issues/${number}`,
		updated_at: updatedAt,
		body: "",
	};
}

function recordTracker(
	requests: string[],
	input: string | URL | Request,
	init?: RequestInit,
): void {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		const parsed = JSON.parse(body) as {
			variables?: { owner?: string; name?: string };
		};
		requests.push(
			`https://api.github.com/repos/${parsed.variables?.owner}/${parsed.variables?.name}/issues?state=all`,
		);
		return;
	}
	if (
		url.startsWith("https://api.github.com/") ||
		url.startsWith("https://api.linear.app/")
	) {
		requests.push(url);
	}
}

export function recorded(
	requests: string[],
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	recordTracker(requests, input, init);
	const url = urlOf(input);
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response(
			JSON.stringify([
				{
					full_name: shown,
					owner: { login: "lev" },
					permissions: { push: true },
					pushed_at: "2026-08-01T12:00:00.000Z",
				},
				{
					full_name: quiet,
					owner: { login: "lev" },
					permissions: { push: true },
					pushed_at: "2026-01-01T12:00:00.000Z",
				},
			]),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	const match = url.match(
		/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\?/,
	);
	if (match?.[1] === shown) {
		return page([issue(1, "2026-08-01T12:00:00.000Z")]);
	}
	if (match?.[1] === quiet) {
		return page([issue(1, "2026-01-01T12:00:00.000Z")]);
	}
	if (match?.[1] === savedRepo) {
		return page([issue(7, "2026-08-10T12:00:00.000Z")]);
	}
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		/\/pulls\/\d+$/.test(url)
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	if (url === "https://api.github.com/graphql") {
		const body = typeof init?.body === "string" ? init.body : "";
		if (body.includes("ProjectByNumber")) {
			return new Response(
				JSON.stringify({
					data: {
						repositoryOwner: {
							projectV2: {
								id: "PVT_acme_7",
								number: 7,
								title: "Acme board",
								closed: false,
								updatedAt: "2026-01-01T12:00:00Z",
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (body.includes("node(id:")) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											number: 1,
											state: "OPEN",
											stateReason: null,
											repository: { nameWithOwner: "acme/other" },
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (body.includes("ViewerProjects") || body.includes("OrgProjects")) {
			return new Response(
				JSON.stringify({
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
						organization: {
							projectsV2: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200 },
			);
		}
		const read = repoReadResponse(input, init);
		if (read !== null) {
			return read;
		}
		return new Response(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: { closingIssuesReferences: { nodes: [] } },
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (url === "https://api.linear.app/graphql") {
		return new Response(
			JSON.stringify({
				data: {
					viewer: { id: "lev" },
					projects: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	return unrecorded(input);
}

export function fetching(requests: string[]): Fetch {
	return async (input, init) => recorded(requests, input, init);
}

const reviewHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function openReviewPull(repo: string): Record<string, unknown> {
	return {
		number: 2,
		title: "Review me",
		state: "open",
		draft: false,
		html_url: `https://github.com/${repo}/pull/2`,
		head: { ref: "2-feat-review", sha: reviewHead },
		body: "Closes #1",
		merged_at: null,
	};
}

function mergedBotPull(repo: string): Record<string, unknown> {
	return {
		number: 1,
		title: "merged",
		state: "closed",
		draft: false,
		html_url: `https://github.com/${repo}/pull/1`,
		head: { ref: "1-merged", sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
		body: "",
		merged_at: "2026-08-01T00:00:00Z",
		user: { login: "lev" },
	};
}

export function fetchingBots(requests: string[], orphan = false): Fetch {
	if (orphan) {
		return async (input, init) => {
			recordTracker(requests, input, init);
			if (urlOf(input) !== "https://api.linear.app/graphql") {
				return recordedBots(requests, input, init);
			}
			return new Response(
				JSON.stringify({
					data: {
						viewer: { id: "lev" },
						projects: {
							nodes: [
								{
									id: "orphan",
									name: "Orphan",
									slugId: "ORPHAN",
									updatedAt: "2026-08-01T12:00:00.000Z",
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
						issues: {
							nodes: [],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				}),
				{ status: 200 },
			);
		};
	}
	const linear = linearFake({
		project: {
			id: "plat",
			name: "Shown",
			slugId: "PLAT",
		},
		issues: [
			{
				identifier: "PLAT-1",
				title: "Ticket 1",
				updatedAt: "2026-08-01T12:00:00.000Z",
				state: { type: "unstarted" },
				attachments: {
					nodes: [
						{
							url: `https://github.com/${shown}/pull/2`,
							title: "Review me",
							sourceType: "github",
						},
					],
				},
			},
		],
		github: async (input, init) => recordedBots(requests, input, init),
		requests,
	});
	return linear;
}

function recordedBots(
	requests: string[],
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	recordTracker(requests, input, init);
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	const url = urlOf(input);
	const sent = typeof init?.body === "string" ? init.body : "";
	if (url === "https://api.github.com/user") {
		return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
	}
	if (url.startsWith("https://api.github.com/user/repos")) {
		return page([
			{
				full_name: shown,
				owner: { login: "lev" },
				permissions: { push: true },
				pushed_at: "2026-08-01T12:00:00.000Z",
			},
		]);
	}
	if (
		url === "https://api.github.com/graphql" &&
		sent.includes("ProjectByNumber")
	) {
		return new Response(
			JSON.stringify({
				data: {
					repositoryOwner: {
						projectV2: {
							id: "PVT_acme_7",
							number: 7,
							title: "Acme board",
							closed: false,
							updatedAt: "2026-08-01T12:00:00Z",
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	const fields = emptyProjectFields(input, init);
	if (fields !== null) {
		return fields;
	}
	if (url === "https://api.github.com/graphql" && sent.includes("node(id:")) {
		if (sent.includes("ProjectV2") || sent.includes("items(first:")) {
			return new Response(
				JSON.stringify({
					data: {
						node: {
							items: {
								nodes: [
									{
										content: {
											__typename: "Issue",
											id: "I_shown_1",
											number: 1,
											title: "Ticket 1",
											state: "OPEN",
											stateReason: null,
											updatedAt: "2026-08-01T12:00:00.000Z",
											repository: { nameWithOwner: shown },
											comments: { totalCount: 0 },
											closedByPullRequestsReferences: {
												nodes: [
													{
														number: 2,
														repository: { nameWithOwner: shown },
													},
												],
												pageInfo: {
													hasNextPage: false,
													endCursor: null,
												},
											},
										},
									},
								],
								pageInfo: { hasNextPage: false, endCursor: null },
							},
						},
					},
				}),
				{ status: 200 },
			);
		}
		return new Response(
			JSON.stringify({
				data: {
					node: {
						closedByPullRequestsReferences: {
							nodes: [
								{
									number: 2,
									repository: { nameWithOwner: shown },
								},
							],
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (
		url === "https://api.github.com/graphql" &&
		sent.includes("query RepoRead")
	) {
		const parsed = JSON.parse(sent) as {
			variables?: { owner?: string; name?: string };
		};
		const owner = parsed.variables?.owner ?? "acme";
		const name = parsed.variables?.name ?? "shown";
		const repo = `${owner}/${name}`;
		if (repo !== shown) {
			return new Response(JSON.stringify(repoReadIssues(owner, name, [])), {
				status: 200,
			});
		}
		const pull = (item: Record<string, unknown>, merged: boolean) => {
			const head = item.head as { ref?: string; sha?: string };
			return {
				number: item.number,
				title: item.title,
				url: item.html_url,
				isDraft: item.draft === true,
				body: item.body,
				state: merged ? "MERGED" : "OPEN",
				mergedAt: merged ? item.merged_at : null,
				headRefName: head.ref,
				headRefOid: head.sha,
				closingIssuesReferences: {
					nodes: merged ? [] : [{ number: 1 }],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
				reviews: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
				comments: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
				reactions: {
					nodes: [],
					pageInfo: { hasNextPage: false, endCursor: null },
				},
				statusCheckRollup: {
					contexts: {
						nodes: merged
							? [
									{
										name: "Grok code review",
										status: "COMPLETED",
										conclusion: "SUCCESS",
									},
								]
							: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			};
		};
		const body = repoReadIssues(
			owner,
			name,
			[
				githubIssueNode({
					number: 1,
					title: "Ticket 1",
					state: "open",
					updated_at: "2026-08-01T12:00:00.000Z",
				}),
			],
			{
				pulls: [pull(openReviewPull(repo), false)],
			},
		) as {
			data: { repository: { mergedPullRequests: { nodes: unknown[] } } };
		};
		body.data.repository.mergedPullRequests.nodes = [
			pull(mergedBotPull(repo), true),
		];
		return new Response(JSON.stringify(body), { status: 200 });
	}
	if (url === "https://api.github.com/graphql") {
		const read = repoReadResponse(input, init);
		if (read !== null) {
			return read;
		}
		return new Response(
			JSON.stringify({
				data: {
					repository: {
						pullRequest: {
							closingIssuesReferences: { nodes: [{ number: 1 }] },
						},
					},
				},
			}),
			{ status: 200 },
		);
	}
	if (url.startsWith(`https://api.github.com/repos/${shown}/issues?`)) {
		return page([
			{
				number: 1,
				title: "Ticket 1",
				state: "open",
				state_reason: null,
				html_url: `https://github.com/${shown}/issues/1`,
				updated_at: "2026-08-01T12:00:00.000Z",
				body: "",
			},
		]);
	}
	if (
		url.startsWith(`https://api.github.com/repos/${shown}/pulls?state=open`)
	) {
		return page([openReviewPull(shown)]);
	}
	if (
		url.startsWith(`https://api.github.com/repos/${shown}/pulls?state=closed`)
	) {
		return page([mergedBotPull(shown)]);
	}
	if (url === `https://api.github.com/repos/${shown}/pulls/2`) {
		return new Response(JSON.stringify(openReviewPull(shown)), {
			status: 200,
		});
	}
	if (
		url.includes(`/commits/${reviewHead}/check-runs`) ||
		url.includes("/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/check-runs")
	) {
		return new Response(
			JSON.stringify({
				check_runs: url.includes(reviewHead)
					? []
					: [
							{
								name: "Grok code review",
								status: "completed",
								conclusion: "success",
								app: { slug: "grok-code-review" },
							},
						],
			}),
			{ status: 200 },
		);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	if (
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions") ||
		url.includes("/labels") ||
		url.includes("/branches")
	) {
		return page([]);
	}
	if (url.includes("/repos/") && url.includes("/issues?")) {
		return page([]);
	}
	return unrecorded(input);
}

export const savedRoot = "/var/tmp/project-flow-saved-root";
export const savedRepo = "acme/from-saved-root";

export function checkoutFor(root: string): LocalCheckout {
	return {
		tracker: "github",
		path: `${root}/acme/from-saved-root`,
		repo: savedRepo,
		originOwner: "acme",
		hasTrackerConfig: true,
		names: [],
	};
}

export async function withAppFile(
	path: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
	listCheckouts?: (roots: string[]) => Promise<LocalCheckout[]>,
	makeFetch: (requests: string[]) => Fetch = fetching,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "project-flow-settings-"));
	const requests: string[] = [];
	let startChecks: (base: string) => void = () => {};
	const checks = new Promise<void>((resolve, reject) => {
		startChecks = (base: string) => {
			check(base, path, requests).then(resolve, reject);
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
				fetch: makeFetch(requests),
				readGhToken: async () => null,
				databasePath: join(root, "project-flow.sqlite"),
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (line) => startChecks(line),
				waitForStop: checks,
				...(listCheckouts === undefined ? {} : { listCheckouts }),
			}),
		);
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export async function withApp(
	body: string,
	check: (
		base: string,
		configPath: string,
		requests: string[],
	) => Promise<void>,
	listCheckouts?: (roots: string[]) => Promise<LocalCheckout[]>,
	makeFetch: (requests: string[]) => Fetch = fetching,
): Promise<void> {
	const { path, cleanup } = await tempConfig(body);
	try {
		await withAppFile(path, check, listCheckouts, makeFetch);
	} finally {
		await cleanup();
	}
}

/** The backend lists of a settings read when every credential is in `credential`. */
export function listedBackends(credential: "present" | "missing") {
	const github = {
		kind: "github",
		label: "GitHub",
		hint: "Token from gh auth token",
		credential,
	};
	return {
		trackers: [
			{ ...github, claimsRuns: true },
			{
				kind: "linear",
				label: "Linear",
				hint: "LINEAR_API_KEY found in the environment",
				credential,
				claimsRuns: false,
			},
		],
		forges: [github],
		hints: {
			runStart:
				"Start run on a GitHub ticket adds the start and queue label. Start run on a Linear ticket writes the workflow state and labels that its hub source names. A GitHub ticket with the label and the queue status of a factory shows as queued. A Linear ticket in the state and labels of its hub source's ready mapping shows as queued.",
			laneMappings:
				"Map a state to a tracker status name for one Linear team or GitHub project.",
		},
		switches: [
			{
				setting: "factoryGithubTokens",
				label: "Factory GitHub tokens",
				hint: "GitHub reads and polls use the factory token for that repo owner. Replies stay on your token.",
			},
		],
	};
}
