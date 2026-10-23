import type { Fetch } from "../src/fetch.ts";
import { connection, page } from "./review-github-fake.ts";
import { head, pull, repo } from "./review-support.ts";
import {
	emptyProjectFields,
	recordedDiscovery,
	repoReadIssues,
	unrecorded,
	urlOf,
} from "./support.ts";

export function projectBoard(
	pulls: { number: number; repo?: string }[] = [{ number: 83 }],
	closingPages?: {
		nodes: { number: number; repository?: { nameWithOwner: string } }[];
		endCursor: string | null;
	}[],
	restComments?: { body: string; user?: { login: string } | null }[],
	extraIssues: {
		id: string;
		number: number;
		title: string;
		pulls: { number: number; repo?: string }[];
		comments: { body: string; user?: { login: string } | null }[];
	}[] = [],
): Fetch {
	const projectId = "PVT_widget";
	return async (input, init) => {
		const url = urlOf(input);
		const sent = typeof init?.body === "string" ? init.body : "";
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("query RepoRead")
		) {
			const parsed = JSON.parse(sent) as {
				variables?: { owner?: string; name?: string };
			};
			const owner = parsed.variables?.owner ?? "acme";
			const name = parsed.variables?.name ?? "widget";
			const key = `${owner}/${name}`;
			const nodes = pulls
				.filter((item) => (item.repo ?? repo) === key)
				.map((item) => ({
					number: item.number,
					title: `PR ${item.number}`,
					url: `https://github.com/${key}/pull/${item.number}`,
					isDraft: false,
					body: "",
					state: "OPEN",
					mergedAt: null,
					headRefName: `${item.number}-feat`,
					headRefOid: head,
					closingIssuesReferences: connection([]),
					reviews: connection([]),
					comments: connection([]),
					reactions: connection([]),
				}));
			return page(repoReadIssues(owner, name, [], { pulls: nodes }));
		}
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		if (url === "https://api.github.com/user") {
			return page({ login: "lev" });
		}
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("ProjectByNumber")
		) {
			return page({
				data: {
					repositoryOwner: {
						projectV2: {
							id: projectId,
							number: 7,
							title: "Widget board",
							closed: false,
							updatedAt: "2026-10-01T00:00:00Z",
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("closedByPullRequestsReferences") &&
			!sent.includes("ProjectV2")
		) {
			const variables = JSON.parse(sent) as {
				variables?: { after?: string | null };
			};
			const after = variables.variables?.after ?? null;
			const index =
				closingPages === undefined
					? -1
					: closingPages.findIndex(
							(_item, itemIndex) =>
								closingPages[itemIndex - 1]?.endCursor === after,
						);
			const listed = closingPages?.[index];
			if (listed === undefined) {
				return new Response("closing page not recorded", { status: 404 });
			}
			return page({
				data: {
					node: {
						closedByPullRequestsReferences: {
							nodes: listed.nodes,
							pageInfo: {
								hasNextPage: listed.endCursor !== null,
								endCursor: listed.endCursor,
							},
						},
					},
				},
			});
		}
		if (
			url === "https://api.github.com/graphql" &&
			sent.includes("ProjectFields")
		) {
			return emptyProjectFields(input, init) ?? unrecorded(input);
		}
		if (url === "https://api.github.com/graphql" && sent.includes("node(id:")) {
			const variables = JSON.parse(sent) as {
				variables?: { after?: string | null };
			};
			const after = variables.variables?.after ?? null;
			const closing =
				closingPages === undefined
					? {
							nodes: pulls.map((item) => ({ number: item.number })),
							hasNextPage: false,
							endCursor: null,
						}
					: (() => {
							const index =
								after === null
									? 0
									: closingPages.findIndex(
											(_item, itemIndex) =>
												closingPages[itemIndex - 1]?.endCursor === after,
										);
							const listed = closingPages[index];
							if (listed === undefined) {
								return null;
							}
							return {
								nodes: listed.nodes,
								hasNextPage: listed.endCursor !== null,
								endCursor: listed.endCursor,
							};
						})();
			if (closing === null) {
				return new Response("closing page not recorded", { status: 404 });
			}
			const issueNodes = [
				{
					content: {
						__typename: "Issue",
						id: "I_widget_8",
						number: 8,
						title: "Ticket 8",
						state: "OPEN",
						stateReason: null,
						updatedAt: "2026-10-01T00:00:00Z",
						repository: { nameWithOwner: repo },
						comments: {
							totalCount: (restComments ?? []).length,
						},
						closedByPullRequestsReferences: {
							nodes: closing.nodes.map((node) => ({
								number: node.number,
								...("repository" in node && node.repository !== undefined
									? { repository: node.repository }
									: {}),
							})),
							pageInfo: {
								hasNextPage: closing.hasNextPage,
								endCursor: closing.endCursor,
							},
						},
					},
				},
				...extraIssues.map((issue) => ({
					content: {
						__typename: "Issue",
						id: issue.id,
						number: issue.number,
						title: issue.title,
						state: "OPEN",
						stateReason: null,
						updatedAt: "2026-10-01T00:00:00Z",
						repository: { nameWithOwner: repo },
						comments: { totalCount: issue.comments.length },
						closedByPullRequestsReferences: {
							nodes: issue.pulls.map((node) => ({
								number: node.number,
								repository: { nameWithOwner: node.repo ?? repo },
							})),
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				})),
			];
			return page({
				data: {
					node: {
						items: {
							nodes: issueNodes,
							pageInfo: { hasNextPage: false, endCursor: null },
						},
					},
				},
			});
		}
		const pullMatch = url.match(/\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/);
		if (pullMatch?.[1] !== undefined && pullMatch[2] !== undefined) {
			const number = Number(pullMatch[2]);
			const recorded = pull(number);
			if (pullMatch[1] !== repo) {
				recorded.html_url = `https://github.com/${pullMatch[1]}/pull/${number}`;
			}
			return page(recorded);
		}
		if (url.includes("/commits/") && url.includes("/check-runs")) {
			return page({ check_runs: [] });
		}
		if (url.includes("/commits/")) {
			return page({
				commit: { committer: { date: "2026-10-01T00:00:00Z" } },
			});
		}
		if (url.includes("/pulls?state=closed")) {
			return page([]);
		}
		const issueComments = url.match(
			new RegExp(
				`^https://api\\.github\\.com/repos/${repo}/issues/(\\d+)/comments\\?per_page=100&page=1$`,
			),
		);
		if (issueComments?.[1] === "8") {
			return page(restComments ?? []);
		}
		const extra = extraIssues.find(
			(issue) => String(issue.number) === issueComments?.[1],
		);
		if (extra !== undefined) {
			return page(extra.comments);
		}
		if (
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			url.includes("/branches") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		return emptyProjectFields(input, init) ?? unrecorded(input);
	};
}
