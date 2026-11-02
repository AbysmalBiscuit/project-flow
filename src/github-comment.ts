import { z } from "zod";

import type { Comment } from "./domain.ts";
import {
	githubReactionGroups,
	githubRestReactions,
	reactionTotal,
	restReactions,
} from "./reactions.ts";

export const graphqlActor = z.object({ login: z.string() }).nullable();

export const graphqlComment = z.object({
	databaseId: z.number().optional(),
	body: z.string().nullable().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	author: graphqlActor.optional(),
	reactionGroups: githubReactionGroups.optional(),
});

export const githubComment = z.object({
	id: z.number().optional(),
	body: z.string().nullable().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	reactions: githubRestReactions.optional(),
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
		...(comment.reactions === undefined
			? {}
			: { reactions: reactionTotal(restReactions(comment.reactions)) }),
	};
}
