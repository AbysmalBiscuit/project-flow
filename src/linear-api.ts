import { z } from "zod";
import type { Fetch } from "./fetch.ts";
import {
	failedResponse,
	type GraphqlRequest,
	graphqlData,
	responseBody,
} from "./graphql.ts";

const linearEndpoint = "https://api.linear.app/graphql";

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

function linearHeaders(key: string): HeadersInit {
	return {
		authorization: key,
		"content-type": "application/json",
	};
}

export type LinearConnection = {
	key: string;
	fetchImpl: Fetch;
	signal?: AbortSignal;
};

/** Send one Linear GraphQL request and return its parsed `data`. */
export async function linearGraphql<Data extends z.ZodType>(
	connection: LinearConnection,
	request: GraphqlRequest<Data>,
): Promise<z.output<Data>> {
	const response = await connection.fetchImpl(linearEndpoint, {
		method: "POST",
		headers: linearHeaders(connection.key),
		body: JSON.stringify({
			query: request.query,
			variables: request.variables,
		}),
		...(connection.signal === undefined ? {} : { signal: connection.signal }),
	});
	if (!response.ok) {
		throw failedResponse("Linear", request, response);
	}
	return graphqlData(
		"Linear",
		request,
		await responseBody("Linear", request, response),
	);
}
