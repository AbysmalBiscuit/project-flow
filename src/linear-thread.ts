import { z } from "zod";

import type {
	FetchedThread,
	LinearShown,
	PostedReply,
	ReplyRequest,
	Ticket,
} from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import { linearStatusType } from "./lanes.ts";
import { commentAuthor, linearGraphql, linearPageInfo } from "./linear-api.ts";
import { TrackerError } from "./ports.ts";

const pageInfo = linearPageInfo;

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
});

const commentCreate = `mutation CommentCreate($input: CommentCreateInput!) {
	commentCreate(input: $input) {
		success
		comment { id body createdAt url }
	}
}`;

const createdComment = z.object({
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
});

export async function fetchLinearThread(
	key: string,
	fetchImpl: Fetch,
	project: string,
	ticketKey: string,
	signal?: AbortSignal,
): Promise<FetchedThread | null> {
	const nodes: NonNullable<
		z.infer<typeof threadPage>["issue"]
	>["comments"]["nodes"] = [];
	let issue: z.infer<typeof threadPage>["issue"] = null;
	let after: string | null = null;
	do {
		const page: z.infer<typeof threadPage> | null = await linearGraphql(
			{ key, fetchImpl, ...(signal === undefined ? {} : { signal }) },
			{
				query: threadQuery,
				variables: { id: ticketKey, after },
				data: threadPage,
				label: "fetch thread",
			},
		).catch((error: unknown) => {
			if (error instanceof TrackerError && error.graphqlErrors.length > 0) {
				return null;
			}
			throw error;
		});
		issue = page?.issue ?? null;
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
			author: commentAuthor(comment.user) ?? "",
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
	const { commentCreate: posted } = await linearGraphql(
		{ key, fetchImpl },
		{
			query: commentCreate,
			variables: { input },
			data: createdComment,
			label: "reply",
		},
	);
	const created = posted.comment;
	if (!posted.success || created === null) {
		throw new TrackerError("Linear reply failed", 502);
	}
	return {
		id: created.id,
		body: created.body ?? reply.body,
		url: created.url,
		createdAt: created.createdAt,
	};
}

const readyLabels = `query ReadyLabels($id: String!, $name: String!) {
	issue(id: $id) { id team { id } }
	issueLabels(first: 250, filter: { name: { eq: $name } }) { nodes { id team { id } } }
}`;

const foundLabels = z.object({
	issue: z
		.object({ id: z.string(), team: z.object({ id: z.string() }) })
		.nullable(),
	issueLabels: z.object({
		nodes: z.array(
			z.object({
				id: z.string(),
				team: z.object({ id: z.string() }).nullable(),
			}),
		),
	}),
});

const issueAddLabel = `mutation IssueAddLabel($id: String!, $labelId: String!) {
	issueAddLabel(id: $id, labelId: $labelId) { success }
}`;

const addedLabel = z.object({
	issueAddLabel: z.object({ success: z.boolean() }),
});

/** Add the label of the ticket's team, or else the workspace label, by its name. */
export async function addLinearLabel(
	key: string,
	fetchImpl: Fetch,
	ticketKey: string,
	label: string,
): Promise<void> {
	const found = await linearGraphql(
		{ key, fetchImpl },
		{
			query: readyLabels,
			variables: { id: ticketKey, name: label },
			data: foundLabels,
			label: "find label",
		},
	);
	const issue = found.issue;
	if (issue === null) {
		throw new TrackerError("Linear label failed: ticket not found", 404);
	}
	const picked = teamLabel(found.issueLabels.nodes, issue.team.id);
	if (picked === undefined) {
		throw new TrackerError(
			`Linear label failed: the team of ${ticketKey} has no label ${label}`,
			409,
		);
	}
	const { issueAddLabel: added } = await linearGraphql(
		{ key, fetchImpl },
		{
			query: issueAddLabel,
			variables: { id: issue.id, labelId: picked.id },
			data: addedLabel,
			label: "add label",
		},
	);
	if (!added.success) {
		throw new TrackerError("Linear label failed", 502);
	}
}

/** The label of the team, or else the workspace label. */
function teamLabel<Label extends { team: { id: string } | null }>(
	labels: Label[],
	teamId: string,
): Label | undefined {
	const usable = labels.filter(
		(node) => node.team === null || node.team.id === teamId,
	);
	return usable.find((node) => node.team !== null) ?? usable[0];
}

const shownStateIds = `query ShownStateIds($id: String!, $labels: [String!]!) {
	issue(id: $id) { id team { id states { nodes { id name } } } }
	issueLabels(first: 250, filter: { name: { in: $labels } }) { nodes { id name team { id } } }
}`;

const foundShownIds = z.object({
	issue: z
		.object({
			id: z.string(),
			team: z.object({
				id: z.string(),
				states: z.object({
					nodes: z.array(z.object({ id: z.string(), name: z.string() })),
				}),
			}),
		})
		.nullable(),
	issueLabels: z.object({
		nodes: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				team: z.object({ id: z.string() }).nullable(),
			}),
		),
	}),
});

const issueShowState = `mutation IssueShowState($id: String!, $input: IssueUpdateInput!) {
	issueUpdate(id: $id, input: $input) {
		success
		issue { state { id name type color } labels(first: 250) { nodes { name } } }
	}
}`;

const shownState = z.object({
	issueUpdate: z.object({
		success: z.boolean(),
		issue: z
			.object({
				state: z.object({
					id: z.string(),
					name: z.string(),
					type: z.string(),
					color: z.string(),
				}),
				labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
			})
			.nullable(),
	}),
});

/**
 * Move the ticket into the workflow state of its team, add and remove the labels, in one update.
 * A label to remove that neither the team nor the workspace has is skipped.
 * Answers the status and the labels of the ticket after the update.
 */
export async function showLinearState(
	key: string,
	fetchImpl: Fetch,
	ticketKey: string,
	shown: LinearShown,
): Promise<Required<Pick<Ticket, "status" | "labels">>> {
	const found = await linearGraphql(
		{ key, fetchImpl },
		{
			query: shownStateIds,
			variables: { id: ticketKey, labels: [...shown.add, ...shown.remove] },
			data: foundShownIds,
			label: "find state",
		},
	);
	const issue = found.issue;
	if (issue === null) {
		throw new TrackerError("Linear move failed: ticket not found", 404);
	}
	const state = issue.team.states.nodes.find(
		(node) => node.name.toLowerCase() === shown.state.toLowerCase(),
	);
	if (state === undefined) {
		throw new TrackerError(
			`Linear move failed: the team of ${ticketKey} has no workflow state ${shown.state}`,
			409,
		);
	}
	const labelIds = (names: string[]) =>
		names.flatMap((name) => {
			const label = teamLabel(
				found.issueLabels.nodes.filter((node) => node.name === name),
				issue.team.id,
			);
			return label === undefined ? [] : [label.id];
		});
	const missing = shown.add.filter((name) => labelIds([name]).length === 0);
	if (missing.length > 0) {
		throw new TrackerError(
			`Linear move failed: the team of ${ticketKey} has no label ${missing.join(", ")}`,
			409,
		);
	}
	const added = labelIds(shown.add);
	const removed = labelIds(shown.remove);
	const { issueUpdate: updated } = await linearGraphql(
		{ key, fetchImpl },
		{
			query: issueShowState,
			variables: {
				id: issue.id,
				input: {
					stateId: state.id,
					...(added.length === 0 ? {} : { addedLabelIds: added }),
					...(removed.length === 0 ? {} : { removedLabelIds: removed }),
				},
			},
			data: shownState,
			label: "move",
		},
	);
	if (!updated.success || updated.issue === null) {
		throw new TrackerError("Linear move failed", 502);
	}
	const moved = updated.issue.state;
	return {
		status: {
			id: moved.id,
			name: moved.name,
			statusType: linearStatusType(moved.type, moved.name),
			colour: moved.color,
		},
		labels: updated.issue.labels.nodes.map((node) => node.name),
	};
}
