import { z } from "zod";
import type { Comment } from "./domain.ts";

export const graphqlActor = z.object({ login: z.string() }).nullable();

export const graphqlComment = z.object({
	databaseId: z.number().optional(),
	body: z.string().nullable().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	author: graphqlActor.optional(),
	reactions: z.object({ totalCount: z.number() }).optional(),
});

export const githubComment = z.object({
	id: z.number().optional(),
	body: z.string().nullable().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	reactions: z.object({ total_count: z.number().optional() }).optional(),
});

export function commentFromGithub(
	comment: z.infer<typeof githubComment>,
): Comment | null {
	const body = comment.body ?? "";
	if (body === "") {
		return null;
	}
	return {
		body,
		...(comment.id === undefined ? {} : { id: String(comment.id) }),
		...(comment.created_at === undefined
			? {}
			: { createdAt: comment.created_at }),
		...(comment.updated_at === undefined
			? {}
			: { updatedAt: comment.updated_at }),
		...(comment.user?.login === undefined
			? {}
			: { author: comment.user.login }),
		...(comment.reactions?.total_count === undefined
			? {}
			: { reactions: comment.reactions.total_count }),
	};
}

export const projectItemComments = z
	.object({
		totalCount: z.number().optional(),
		nodes: z.array(graphqlComment.optional().catch(undefined)).optional(),
	})
	.optional();

export async function projectComments(
	comments: z.infer<typeof projectItemComments>,
	fetchRest: boolean,
	list: () => Promise<Comment[]>,
): Promise<Comment[]> {
	const listed = commentBodies(comments);
	if (listed.length > 0) {
		return listed;
	}
	if (!fetchRest || (comments?.totalCount ?? 0) === 0) {
		return [];
	}
	return list();
}

export function commentBodies(
	comments:
		| {
				nodes?: (z.infer<typeof graphqlComment> | undefined)[] | undefined;
		  }
		| undefined,
): Comment[] {
	const nodes = comments?.nodes;
	if (nodes === undefined) {
		return [];
	}
	return nodes.flatMap((comment) => {
		if (comment === undefined) {
			return [];
		}
		const mapped = commentFromGithub({
			...(comment.databaseId === undefined ? {} : { id: comment.databaseId }),
			body: comment.body,
			created_at: comment.createdAt,
			updated_at: comment.updatedAt,
			user: comment.author ?? null,
			reactions:
				comment.reactions === undefined
					? undefined
					: { total_count: comment.reactions.totalCount },
		});
		return mapped === null ? [] : [mapped];
	});
}
