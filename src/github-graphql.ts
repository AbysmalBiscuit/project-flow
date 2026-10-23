import { z } from "zod";

export const pageInfo = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

export const graphqlConnection = <T extends z.ZodType>(node: T) =>
	z.object({
		nodes: z.array(node.optional().catch(undefined)),
		pageInfo: pageInfo.optional(),
	});

export const graphqlDependency = z.object({
	number: z.number(),
	title: z.string().nullable().optional(),
	state: z.string(),
	repository: z.object({ nameWithOwner: z.string() }).nullable().optional(),
});
