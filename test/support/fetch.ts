export function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

export type TrackerRequest = {
	url: string;
	query: string;
	variables: Record<string, unknown>;
};

export function trackerRequest(
	input: string | URL | Request,
	init?: RequestInit,
): TrackerRequest {
	const body = typeof init?.body === "string" ? init.body : "";
	let query = "";
	let variables: Record<string, unknown> = {};
	if (body !== "") {
		const parsed = JSON.parse(body) as {
			query?: string;
			variables?: Record<string, unknown>;
		};
		query = parsed.query ?? "";
		variables = parsed.variables ?? {};
	}
	return { url: urlOf(input), query, variables };
}

export function json(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}
