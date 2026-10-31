import { z } from "zod";

import type { Comment, Ticket, TicketRef } from "./domain.ts";
import { graphqlConnection, graphqlDependency } from "./github-graphql.ts";
import { closedStatusType } from "./lanes.ts";
import { numberedKey } from "./ticket-key.ts";

export const pageSize = 100;

export const connectionPage = `pageInfo { hasNextPage endCursor }`;

export const nestedPageSize = 20;

export const issueTicketFields = (
	labelPage: number,
) => `number title url state stateReason updatedAt createdAt closedAt body
				labels(first: ${labelPage}) { nodes { name } ${connectionPage} }
				assignees(first: 10) { nodes { login } }
				milestone { title }
				parent { number title state stateReason url repository { nameWithOwner } }
				blockedBy(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}
				blocking(first: 20) {
					nodes { number title state repository { nameWithOwner } }
					${connectionPage}
				}`;

const githubParent = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string().optional(),
	stateReason: z.string().nullable().optional(),
	url: z.string().optional(),
	repository: z.object({ nameWithOwner: z.string() }),
});

function parentOf(
	parent: z.infer<typeof githubParent> | null | undefined,
): Pick<Ticket, "parent" | "parentDetails"> {
	if (parent === null || parent === undefined) {
		return { parent: null };
	}
	const project = parent.repository.nameWithOwner;
	const key = numberedKey(project, parent.number);
	const state = githubState(parent.state ?? "");
	if (state === null || parent.url === undefined) {
		return { parent: key };
	}
	return {
		parent: key,
		parentDetails: {
			title: parent.title ?? "",
			...(state === "open"
				? {}
				: {
						state: closedStatusType(githubReason(parent.stateReason ?? null)),
					}),
			project,
			url: parent.url,
		},
	};
}

export const githubIssue = z.object({
	number: z.number(),
	title: z.string(),
	url: z.string().optional(),
	state: z.string(),
	stateReason: z.string().nullable().optional(),
	updatedAt: z.string(),
	createdAt: z.string().optional(),
	closedAt: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	labels: graphqlConnection(z.object({ name: z.string() })).optional(),
	assignees: z
		.object({ nodes: z.array(z.object({ login: z.string() })) })
		.optional(),
	milestone: z.object({ title: z.string() }).nullable().optional(),
	parent: githubParent.nullable().optional().catch(null),
	blockedBy: graphqlConnection(graphqlDependency).optional().catch(undefined),
	blocking: graphqlConnection(graphqlDependency).optional(),
});

export function githubState(state: string): "open" | "closed" | null {
	const lower = state.toLowerCase();
	if (lower === "open" || lower === "closed") {
		return lower;
	}
	return null;
}

export function githubReason(reason: string | null): string | null {
	if (reason === null) {
		return null;
	}
	const lowered = reason.toLowerCase();
	if (lowered === "completed") {
		return null;
	}
	if (lowered === "not_planned" || lowered === "duplicate") {
		return lowered;
	}
	return reason;
}

export function dependencyRefs(
	nodes: {
		number: number;
		title?: string | null | undefined;
		state: string;
		repository?: { nameWithOwner: string } | null | undefined;
	}[],
	fallback: string,
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const node of nodes) {
		const state = githubState(node.state);
		if (state === null) {
			continue;
		}
		const project = node.repository?.nameWithOwner ?? fallback;
		const title = node.title?.trim() ?? "";
		const ref: TicketRef = {
			tracker: "github",
			project,
			key: numberedKey(project, node.number),
			state,
			...(title === "" ? {} : { title }),
		};
		if (!refs.some((item) => item.key === ref.key)) {
			refs.push(ref);
		}
	}
	return refs;
}

export function ticketFromGithubIssue(
	issue: z.infer<typeof githubIssue>,
	repo: string,
	comments: Comment[],
): Ticket {
	const closedAt = issue.closedAt?.trim() ?? "";
	const createdAt = issue.createdAt?.trim() ?? "";
	const state = issue.state.toLowerCase();
	const blockedBy = dependencyRefs(
		(issue.blockedBy?.nodes ?? []).flatMap((node) =>
			node === undefined ? [] : [node],
		),
		repo,
	);
	const blocking =
		state === "closed"
			? []
			: dependencyRefs(
					(issue.blocking?.nodes ?? []).flatMap((node) =>
						node === undefined ? [] : [node],
					),
					repo,
				);
	const assignees = (issue.assignees?.nodes ?? []).flatMap((person) =>
		person === undefined ? [] : [person.login],
	);
	return {
		id: String(issue.number),
		tracker: "github",
		key: numberedKey(repo, issue.number),
		title: issue.title,
		...(issue.url === undefined ? {} : { url: issue.url }),
		state: state === "closed" ? "closed" : "open",
		stateReason: githubReason(issue.stateReason ?? null),
		updatedAt: issue.updatedAt,
		ref: numberedKey(repo, issue.number),
		body: issue.body ?? "",
		blockedBy,
		...(blocking.length === 0 ? {} : { blocks: blocking }),
		...(comments.length === 0 ? {} : { comments }),
		milestone: issue.milestone?.title ?? null,
		...parentOf(issue.parent),
		labels:
			issue.labels?.nodes.flatMap((label) =>
				label === undefined ? [] : [label.name],
			) ?? [],
		...(closedAt === "" ? {} : { closedAt }),
		...(createdAt === "" ? {} : { createdAt }),
		...(assignees.length === 0
			? {}
			: { assignee: assignees[0] ?? null, assignees }),
	};
}

export type Connection<T> = {
	nodes: T[];
	pageInfo?: { hasNextPage: boolean; endCursor: string | null } | undefined;
};

export function nextCursor<T>(
	connection: Connection<T> | null | undefined,
): string | null {
	if (connection?.pageInfo?.hasNextPage !== true) {
		return null;
	}
	return connection.pageInfo.endCursor;
}
