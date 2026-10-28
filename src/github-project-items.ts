import { z } from "zod";

import type { Comment, PullRequest, Ticket, TicketStatus } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { commentFromGithub, githubComment } from "./github-comment.ts";
import {
	githubGraphql,
	graphqlDependency,
	pageInfo,
} from "./github-graphql.ts";
import {
	githubIssue,
	githubState,
	issueTicketFields,
	nextCursor,
	pageSize,
	ticketFromGithubIssue,
} from "./github-issue.ts";
import { pages } from "./github-pages.ts";
import {
	loadLinkedPulls,
	type PullLink,
	type ReviewEvidence,
} from "./github-pulls.ts";
import { statusTypeOfName } from "./lanes.ts";
import { TrackerError } from "./ports.ts";
import { githubKey } from "./ticket-key.ts";
import { statusColours } from "./token-palette.ts";

const closingPullNode = z.object({
	number: z.number(),
	repository: z.object({ nameWithOwner: z.string() }).optional(),
});

const closingPullsQuery = `query ClosingPulls($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			closedByPullRequestsReferences(first: 20, after: $after) {
				nodes { number repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const closingPulls = z.object({
	node: z
		.object({
			closedByPullRequestsReferences: z.object({
				nodes: z.array(closingPullNode),
				pageInfo,
			}),
		})
		.nullable(),
});

const projectItemsQuery = `query ProjectItems($id: ID!, $after: String) {
	node(id: $id) {
		... on ProjectV2 {
			items(first: 50, after: $after) {
				nodes {
					fieldValueByName(name: "Status") {
						... on ProjectV2ItemFieldSingleSelectValue {
							name
							optionId
							color
							updatedAt
						}
					}
					content {
						__typename
						... on Issue {
							id ${issueTicketFields(pageSize)}
							comments { totalCount }
							repository { nameWithOwner }
							closedByPullRequestsReferences(first: 20) {
								nodes { number repository { nameWithOwner } }
								pageInfo { hasNextPage endCursor }
							}
						}
					}
				}
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const blockedByQuery = `query BlockedBy($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			blockedBy(first: 20, after: $after) {
				nodes { number title state repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const blockingQuery = `query Blocking($id: ID!, $after: String) {
	node(id: $id) {
		... on Issue {
			blocking(first: 20, after: $after) {
				nodes { number title state repository { nameWithOwner } }
				pageInfo { hasNextPage endCursor }
			}
		}
	}
}`;

const dependencyConnection = z.object({
	nodes: z.array(graphqlDependency),
	pageInfo,
});

const dependencyPage = z.object({
	node: z
		.object({
			blockedBy: dependencyConnection.optional(),
			blocking: dependencyConnection.optional(),
		})
		.nullable(),
});

const projectItem = z.object({
	fieldValueByName: z
		.object({
			name: z.string().nullable().optional(),
			optionId: z.string().nullable().optional(),
			color: z.string().nullable().optional(),
			updatedAt: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
	content: githubIssue
		.partial()
		.extend({
			__typename: z.string(),
			id: z.string().optional(),
			comments: z.object({ totalCount: z.number() }).optional(),
			repository: z.object({ nameWithOwner: z.string() }).optional(),
			closedByPullRequestsReferences: z
				.object({
					nodes: z.array(closingPullNode),
					pageInfo,
				})
				.optional(),
		})
		.nullable(),
});

const projectItems = z.object({
	node: z
		.object({
			items: z.object({
				nodes: z.array(projectItem),
				pageInfo,
			}),
		})
		.nullable(),
});

export type ProjectItem = z.infer<typeof projectItem>;

const githubOptionColours: Record<string, string> = {
	GRAY: "#BEC2C8",
	PURPLE: "#5E6AD2",
	YELLOW: "#F2C94C",
	BLUE: "#4C9AFF",
	GREEN: "#4CB782",
	RED: "#EB5757",
	ORANGE: "#F2994A",
	PINK: "#F7C8C8",
};

function githubOptionColour(color: string): string {
	return githubOptionColours[color] ?? statusColours.backlog;
}

function openIssues(items: ProjectItem[]) {
	return items.flatMap(({ content }) =>
		content === null ||
		content.__typename !== "Issue" ||
		content.number === undefined ||
		content.repository === undefined ||
		githubState(content.state ?? "") !== "open"
			? []
			: [
					{
						content,
						repo: content.repository.nameWithOwner,
						key: githubKey(content.repository.nameWithOwner, content.number),
					},
				],
	);
}

export function openLinkedKeys(items: ProjectItem[]): Set<string> {
	return new Set(
		openIssues(items).flatMap(({ content, key }) =>
			(content.closedByPullRequestsReferences?.nodes.length ?? 0) > 0
				? [key]
				: [],
		),
	);
}

export async function listProjectItems(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
	projectOwner: string,
): Promise<ProjectItem[]> {
	const items: ProjectItem[] = [];
	let after: string | null = null;
	do {
		const page: z.infer<typeof projectItems> = await githubGraphql(
			{ token, fetchImpl },
			{
				query: projectItemsQuery,
				variables: { id: projectId, after, projectOwner },
				data: projectItems,
				label: "list project tickets",
				subject: projectId,
			},
		);
		if (page.node === null) {
			throw new TrackerError(
				`GitHub list project tickets failed: ${projectId}`,
				502,
			);
		}
		for (const item of page.node.items.nodes) {
			items.push(item);
		}
		after = page.node.items.pageInfo.hasNextPage
			? page.node.items.pageInfo.endCursor
			: null;
	} while (after !== null);
	return items;
}

function githubItemStatus(
	value: z.infer<typeof projectItem>["fieldValueByName"],
) {
	const name = value?.name?.trim() ?? "";
	const optionId = value?.optionId ?? "";
	if (name === "" || optionId === "") {
		return { emptyStatus: true };
	}
	const statusType = statusTypeOfName(name);
	const at = value?.updatedAt?.trim() ?? "";
	return {
		status: {
			id: optionId,
			name,
			statusType,
			colour: githubOptionColour(value?.color ?? ""),
		},
		...(at === "" ? {} : { history: [{ statusId: optionId, at, statusType }] }),
	};
}

const projectFieldsQuery = `query ProjectFields($id: ID!) {
	node(id: $id) {
		... on ProjectV2 {
			fields(first: 20) {
				nodes {
					... on ProjectV2SingleSelectField {
						id
						name
						options { id name color }
					}
				}
			}
		}
	}
}`;

const projectFields = z.object({
	node: z
		.object({
			fields: z.object({
				nodes: z.array(
					z.union([
						z.object({
							id: z.string(),
							name: z.string(),
							options: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
									color: z.string(),
								}),
							),
						}),
						z.object({}).strict(),
					]),
				),
			}),
		})
		.nullable(),
});

export async function listProjectStatuses(
	token: string,
	fetchImpl: Fetch,
	projectId: string,
	projectOwner: string,
): Promise<TicketStatus[]> {
	const page = await githubGraphql(
		{ token, fetchImpl },
		{
			query: projectFieldsQuery,
			variables: { id: projectId, projectOwner },
			data: projectFields,
			label: "list project statuses",
			subject: projectId,
		},
	);
	const field = page.node?.fields.nodes.find(
		(node) => "name" in node && node.name === "Status",
	);
	if (field === undefined) {
		return [];
	}
	return field.options.map((option) => ({
		id: option.id,
		name: option.name,
		statusType: statusTypeOfName(option.name),
		colour: githubOptionColour(option.color),
	}));
}

async function connectionPages<Data extends z.ZodType, Node>(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
	query: string,
	label: string,
	projectOwner: string,
	data: Data,
	read: (page: z.infer<Data>) =>
		| {
				nodes: Node[];
				pageInfo: z.infer<typeof pageInfo>;
		  }
		| undefined,
): Promise<Node[]> {
	const nodes: Node[] = [];
	let after: string | null = start;
	do {
		const page = await githubGraphql(
			{ token, fetchImpl },
			{
				query,
				variables: { id: issueId, after, projectOwner },
				data,
				label,
				subject: issueId,
			},
		);
		const connection = read(page);
		if (connection === undefined) {
			throw new TrackerError(`GitHub ${label} failed: ${issueId}`, 502);
		}
		nodes.push(...connection.nodes);
		after = connection.pageInfo.hasNextPage
			? connection.pageInfo.endCursor
			: null;
	} while (after !== null);
	return nodes;
}

const dependencyQueries = {
	blockedBy: { query: blockedByQuery, label: "list blockers" },
	blocking: { query: blockingQuery, label: "list blocked tickets" },
};

async function dependencyPages(
	token: string,
	fetchImpl: Fetch,
	issueId: string | undefined,
	relation: keyof typeof dependencyQueries,
	first: z.infer<typeof githubIssue>[typeof relation],
	projectOwner: string,
): Promise<z.infer<typeof graphqlDependency>[]> {
	const nodes = (first?.nodes ?? []).flatMap((node) =>
		node === undefined ? [] : [node],
	);
	const start = nextCursor(first);
	if (start === null || issueId === undefined) {
		return nodes;
	}
	const { query, label } = dependencyQueries[relation];
	const rest = await connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		query,
		label,
		projectOwner,
		dependencyPage,
		(page) => page.node?.[relation],
	);
	return [...nodes, ...rest];
}

export async function listProjectTickets(
	token: string,
	fetchImpl: Fetch,
	items: ProjectItem[],
	openKeys: Set<string>,
	projectOwner: string,
): Promise<Ticket[]> {
	const tickets: Ticket[] = [];
	for (const item of items) {
		const content = item.content;
		if (
			content === null ||
			content.__typename !== "Issue" ||
			content.number === undefined ||
			content.state === undefined ||
			content.repository === undefined
		) {
			continue;
		}
		const state = githubState(content.state);
		if (state === null) {
			continue;
		}
		const repoName = content.repository.nameWithOwner;
		const ticketKey = githubKey(repoName, content.number);
		const comments =
			state === "open" &&
			openKeys.has(ticketKey) &&
			(content.comments?.totalCount ?? 0) > 0
				? await listCommentBodies(token, fetchImpl, repoName, content.number)
				: [];
		const blockedBy = await dependencyPages(
			token,
			fetchImpl,
			content.id,
			"blockedBy",
			content.blockedBy,
			projectOwner,
		);
		const blocking =
			state === "closed"
				? []
				: await dependencyPages(
						token,
						fetchImpl,
						content.id,
						"blocking",
						content.blocking,
						projectOwner,
					);
		tickets.push({
			...ticketFromGithubIssue(
				{
					...content,
					number: content.number,
					title: content.title ?? "",
					state,
					updatedAt: content.updatedAt ?? "",
					blockedBy: { nodes: blockedBy },
					blocking: { nodes: blocking },
				},
				repoName,
				comments,
			),
			...githubItemStatus(item.fieldValueByName),
		});
	}
	return tickets;
}

function closingPullPages(
	token: string,
	fetchImpl: Fetch,
	issueId: string,
	start: string,
	projectOwner: string,
): Promise<z.infer<typeof closingPullNode>[]> {
	return connectionPages(
		token,
		fetchImpl,
		issueId,
		start,
		closingPullsQuery,
		"list closing pulls",
		projectOwner,
		closingPulls,
		(page) => page.node?.closedByPullRequestsReferences,
	);
}

export async function listProjectPulls(
	token: string,
	fetchImpl: Fetch,
	items: ProjectItem[],
	seen: Map<string, ReviewEvidence>,
	projectOwner: string,
): Promise<PullRequest[]> {
	const links: PullLink[] = [];
	for (const { content, repo, key: ticketKey } of openIssues(items)) {
		const linkedPulls = [
			...(content.closedByPullRequestsReferences?.nodes ?? []),
		];
		const closingAfter = content.closedByPullRequestsReferences?.pageInfo
			.hasNextPage
			? content.closedByPullRequestsReferences.pageInfo.endCursor
			: null;
		if (closingAfter !== null && content.id !== undefined) {
			linkedPulls.push(
				...(await closingPullPages(
					token,
					fetchImpl,
					content.id,
					closingAfter,
					projectOwner,
				)),
			);
		}
		for (const linked of linkedPulls) {
			links.push({
				repo: linked.repository?.nameWithOwner ?? repo,
				number: linked.number,
				ticketKey,
			});
		}
	}
	const repos = items.flatMap(({ content }) =>
		content?.repository === undefined ? [] : [content.repository.nameWithOwner],
	);
	return loadLinkedPulls(token, fetchImpl, links, repos, seen);
}

async function listCommentBodies(
	token: string,
	fetchImpl: Fetch,
	repo: string,
	number: number,
): Promise<Comment[]> {
	const listed = await pages(
		`https://api.github.com/repos/${repo}/issues/${number}/comments?per_page=100&page=1`,
		token,
		fetchImpl,
		repo,
		"list comments",
	);
	const bodies: Comment[] = [];
	for (const item of listed) {
		for (const comment of z.array(githubComment).parse(item)) {
			const mapped = commentFromGithub(comment);
			if (mapped !== null) {
				bodies.push(mapped);
			}
		}
	}
	return bodies;
}
