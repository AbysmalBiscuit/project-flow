import { z } from "zod";

export const linearEndpoint = "https://api.linear.app/graphql";

export const linearPageInfo = z.object({
	hasNextPage: z.boolean(),
	endCursor: z.string().nullable(),
});

export function commentAuthor(
	user:
		| {
				name?: string | null | undefined;
				displayName?: string | null | undefined;
		  }
		| null
		| undefined,
): string | undefined {
	if (user?.displayName !== undefined && user.displayName !== null) {
		return user.displayName;
	}
	if (user?.name !== undefined && user.name !== null) {
		return user.name;
	}
	return undefined;
}
