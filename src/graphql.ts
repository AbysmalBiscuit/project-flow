import { z } from "zod";
import { TrackerError } from "./ports.ts";

const graphqlErrors = z.object({
	errors: z.array(z.object({ message: z.string() })).min(1),
});

const graphqlEnvelope = z.object({ data: z.unknown() });

/** What a request reads, as its error messages name it. */
export type GraphqlSubject = {
	/** The action in the error message, such as "read repo". */
	label: string;
	/** What the request read, such as the repo name. */
	subject?: string;
};

export type GraphqlQuery = GraphqlSubject & {
	query: string;
	variables: Record<string, unknown>;
};

export type GraphqlRequest<Data extends z.ZodType> = GraphqlQuery & {
	data: Data;
};

/** The tracker error for a GraphQL response with a failed HTTP status. */
export function failedResponse(
	tracker: string,
	request: GraphqlSubject,
	response: Response,
): TrackerError {
	return new TrackerError(
		`${tracker} ${request.label} failed (HTTP ${response.status})${about(request)}`,
		response.status,
	);
}

function about(request: GraphqlSubject): string {
	return request.subject === undefined ? "" : `: ${request.subject}`;
}

/** Read the `data` of a GraphQL body, or throw its first GraphQL error. */
export function graphqlData<Data extends z.ZodType>(
	tracker: string,
	request: GraphqlSubject & { data: Data },
	body: unknown,
): z.output<Data> {
	const failed = graphqlErrors.safeParse(body);
	if (failed.success) {
		const messages = failed.data.errors.map((error) => error.message);
		throw new TrackerError(
			`${tracker} ${request.label} failed: ${messages[0]}`,
			502,
			messages,
		);
	}
	const envelope = graphqlEnvelope.safeParse(body);
	const parsed = request.data.safeParse(
		envelope.success ? envelope.data.data : undefined,
	);
	if (!parsed.success) {
		throw new TrackerError(
			`${tracker} ${request.label} failed${about(request)}`,
			502,
		);
	}
	return parsed.data;
}
