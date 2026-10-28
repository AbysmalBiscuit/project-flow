import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NeedsYouItem, Overview } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { run } from "../../src/main.ts";
import recordedRepoRead from "../fixtures/github-repo-read.json";
import { tempConfig, testIo } from "../support/app.ts";
import { json, trackerRequest } from "../support/fetch.ts";
import { unrecorded } from "../support/github.ts";

const repoCount = 10;
const pullCount = 10;
export const repos = Array.from(
	{ length: repoCount },
	(_, index) => `acme/repo-${index}`,
);

export type RepoBody = {
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

export type Connection<T> = {
	nodes: T[];
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

export type GraphqlRequest = {
	url: string;
	query: string;
	variables: Record<string, unknown>;
};

export const recorded = recordedRepoRead as RepoBody;
export const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

export function operationName(query: string): string | undefined {
	return query.match(/^\s*query\s+(\w+)/)?.[1];
}

export function renamed(
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

export function budgetRead(owner: string, name: string): RepoBody {
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

export function graphql(
	input: string | URL | Request,
	init?: RequestInit,
): GraphqlRequest {
	const request = trackerRequest(input, init);
	return request;
}

export function membership(
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

export async function startCounted(
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
	const root = await mkdtemp(join(tmpdir(), "project-flow-batch-"));
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
