import { z } from "zod";

import type { Fetch } from "./fetch.ts";
import { fetchWithSignal, githubHeaders } from "./github-pages.ts";
import {
	failedResponse,
	graphqlData,
	type GraphqlQuery,
	type GraphqlRequest,
	responseBody,
} from "./graphql.ts";

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

export type GithubConnection = {
	token: string;
	fetchImpl: Fetch;
	signal?: AbortSignal;
};

/** Send one GitHub GraphQL request and return its parsed `data`. */
export async function githubGraphql<Data extends z.ZodType>(
	connection: GithubConnection,
	request: GraphqlRequest<Data>,
): Promise<z.output<Data>> {
	return graphqlData(
		"GitHub",
		request,
		await postGithubGraphql(connection, request),
	);
}

/** Send one GitHub GraphQL request and return its whole JSON body. */
export async function postGithubGraphql(
	connection: GithubConnection,
	request: GraphqlQuery,
): Promise<unknown> {
	const response = await fetchWithSignal(
		connection.fetchImpl,
		"https://api.github.com/graphql",
		{
			method: "POST",
			headers: githubHeaders(connection.token),
			body: JSON.stringify({
				query: request.query,
				variables: request.variables,
			}),
		},
		connection.signal,
	);
	if (!response.ok) {
		throw failedResponse("GitHub", request, response);
	}
	return responseBody("GitHub", request, response);
}
