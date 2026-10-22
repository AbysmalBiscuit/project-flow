import { z } from "zod";
import type { FetchedThread, PostedReply, ReplyRequest } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { TrackerError } from "./github.ts";
import { linearError, linearHeaders } from "./linear.ts";

const endpoint = "https://api.linear.app/graphql";

const pageInfo = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

function commentAuthor(
	user:
		| {
				name?: string | null | undefined;
				displayName?: string | null | undefined;
		  }
		| null
		| undefined,
): string {
	if (user?.displayName !== undefined && user.displayName !== null) {
		return user.displayName;
	}
	if (user?.name !== undefined && user.name !== null) {
		return user.name;
	}
	return "";
}

const threadQuery = `query IssueThread($id: String!, $after: String) {
	issue(id: $id) {
		identifier
		title
		url
		comments(first: 50, after: $after) {
			nodes {
				id
				body
				createdAt
				url
				parent { id }
				user { name displayName }
			}
			pageInfo { hasNextPage endCursor }
		}
	}
}`;

const threadPage = z.object({
	data: z.object({
		issue: z
			.object({
				identifier: z.string(),
				title: z.string(),
				url: z.string(),
				comments: z.object({
					nodes: z.array(
						z.object({
							id: z.string(),
							body: z.string().nullable().optional(),
							createdAt: z.string().optional(),
							url: z.string().optional(),
							parent: z.object({ id: z.string() }).nullable().optional(),
							user: z
								.object({
									name: z.string().nullable().optional(),
									displayName: z.string().nullable().optional(),
								})
								.nullable()
								.optional(),
						}),
					),
					pageInfo,
				}),
			})
			.nullable(),
	}),
});

const commentCreate = `mutation CommentCreate($input: CommentCreateInput!) {
	commentCreate(input: $input) {
		success
		comment { id body createdAt url }
	}
}`;

const createdComment = z.object({
	data: z.object({
		commentCreate: z.object({
			success: z.boolean(),
			comment: z
				.object({
					id: z.string(),
					body: z.string().nullable().optional(),
					createdAt: z.string(),
					url: z.string(),
				})
				.nullable(),
		}),
	}),
});

async function linearPost(
	key: string,
	fetchImpl: Fetch,
	queryText: string,
	variables: Record<string, unknown>,
	label: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: linearHeaders(key),
		body: JSON.stringify({ query: queryText, variables }),
		...(signal === undefined ? {} : { signal }),
	});
	if (!response.ok) {
		throw new TrackerError(
			`Linear ${label} failed (HTTP ${response.status})`,
			response.status,
		);
	}
	return response.json();
}

export async function fetchLinearThread(
	key: string,
	fetchImpl: Fetch,
	project: string,
	ticketKey: string,
	signal?: AbortSignal,
): Promise<FetchedThread | null> {
	const nodes: NonNullable<
		z.infer<typeof threadPage>["data"]["issue"]
	>["comments"]["nodes"] = [];
	let issue: z.infer<typeof threadPage>["data"]["issue"] | null = null;
	let after: string | null = null;
	do {
		const body = await linearPost(
			key,
			fetchImpl,
			threadQuery,
			{ id: ticketKey, after },
			"fetch thread",
			signal,
		);
		if (linearError(body, "fetch thread") !== null) {
			return null;
		}
		const page = threadPage.parse(body);
		issue = page.data.issue;
		if (issue === null) {
			return null;
		}
		nodes.push(...issue.comments.nodes);
		after = issue.comments.pageInfo.hasNextPage
			? issue.comments.pageInfo.endCursor
			: null;
	} while (after !== null);
	const comments = nodes
		.map((comment) => ({
			id: comment.id,
			body: comment.body ?? "",
			author: commentAuthor(comment.user),
			createdAt: comment.createdAt ?? "",
			url: comment.url ?? "",
			parentId: comment.parent?.id ?? null,
			kind: "comment" as const,
			children: [],
		}))
		.sort((left, right) => {
			const leftTime = Date.parse(left.createdAt);
			const rightTime = Date.parse(right.createdAt);
			return (
				(Number.isNaN(leftTime) ? 0 : leftTime) -
				(Number.isNaN(rightTime) ? 0 : rightTime)
			);
		});
	return {
		tracker: "linear",
		project,
		key: issue.identifier,
		title: issue.title,
		url: issue.url,
		comments,
	};
}

export async function postLinearReply(
	key: string,
	fetchImpl: Fetch,
	reply: ReplyRequest,
): Promise<PostedReply> {
	const input = {
		issueId: reply.key,
		body: reply.body,
		...(reply.parentId === undefined ? {} : { parentId: reply.parentId }),
	};
	const body = await linearPost(
		key,
		fetchImpl,
		commentCreate,
		{ input },
		"reply",
	);
	const failed = linearError(body, "reply");
	if (failed !== null) {
		throw new TrackerError(failed, 502);
	}
	const page = createdComment.parse(body);
	const created = page.data.commentCreate.comment;
	if (!page.data.commentCreate.success || created === null) {
		throw new TrackerError("Linear reply failed", 502);
	}
	return {
		id: created.id,
		body: created.body ?? reply.body,
		url: created.url,
		createdAt: created.createdAt,
	};
}
