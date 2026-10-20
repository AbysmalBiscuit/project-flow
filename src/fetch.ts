export type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function isTrackerRequest(input: string | URL | Request): boolean {
	const url = urlOf(input);
	return (
		url.startsWith("https://api.github.com/") ||
		url.startsWith("https://api.linear.app/")
	);
}

export function abortableFetch(fetchImpl: Fetch, signal: AbortSignal): Fetch {
	return (input, init) => {
		if (init?.signal !== undefined || !isTrackerRequest(input)) {
			return fetchImpl(input, init);
		}
		return fetchImpl(input, { ...init, signal });
	};
}
