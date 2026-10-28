import type { Fetch } from "./fetch.ts";

type RestEntry = {
	etag: string;
	body: unknown;
	headers: [string, string][];
};

type RestCache = Map<string, RestEntry>;

/** The last GitHub REST response for each URL, kept across restarts. */
export type ValidatorStore = {
	read: () => { url: string; etag: string; body: string; headers: string }[];
	record: (url: string, etag: string, body: string, headers: string) => void;
};

function restUrl(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

function restKey(url: string): string {
	const parsed = new URL(url);
	parsed.searchParams.sort();
	return parsed.href;
}

function cachedHeaders(entry: RestEntry): Headers {
	const headers = new Headers(entry.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.delete("transfer-encoding");
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return headers;
}

function storedHeaders(response: Response): [string, string][] {
	return [...response.headers.entries()].filter(
		([name]) =>
			name !== "content-encoding" &&
			name !== "content-length" &&
			name !== "transfer-encoding",
	);
}

function isRestRead(url: string, method: string): boolean {
	if (method !== "GET" && method !== "") {
		return false;
	}
	if (!url.startsWith("https://api.github.com/")) {
		return false;
	}
	return !url.startsWith("https://api.github.com/graphql");
}

function parseStoredHeaders(headers: string): [string, string][] {
	const parsed: unknown = JSON.parse(headers);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const entries: [string, string][] = [];
	for (const item of parsed) {
		if (!Array.isArray(item) || item.length < 2) {
			continue;
		}
		const name = item[0];
		const value = item[1];
		if (typeof name === "string" && typeof value === "string") {
			entries.push([name, value]);
		}
	}
	return entries;
}

function rememberValidator(
	cache: RestCache,
	url: string,
	etag: string,
	body: unknown,
	headers: string,
): void {
	const key = restKey(url);
	const stored = parseStoredHeaders(headers);
	const restored =
		stored.length > 0
			? stored
			: ([["etag", etag]] satisfies [string, string][]);
	cache.set(key, {
		etag,
		body,
		headers: restored,
	});
}

function sameHeaders(
	left: [string, string][],
	right: [string, string][],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every(
		([name, value], index) =>
			name === right[index]?.[0] && value === right[index]?.[1],
	);
}

export function conditionalFetch(
	fetchImpl: Fetch,
	validators?: ValidatorStore,
): Fetch {
	const cache: RestCache = new Map();
	for (const validator of validators?.read() ?? []) {
		rememberValidator(
			cache,
			validator.url,
			validator.etag,
			JSON.parse(validator.body) as unknown,
			validator.headers,
		);
	}
	return async (input, init) => {
		const url = restUrl(input);
		const method = (init?.method ?? "GET").toUpperCase();
		if (!isRestRead(url, method)) {
			return fetchImpl(input, init);
		}
		const key = restKey(url);
		const stored = cache.get(key);
		const headers = new Headers(init?.headers);
		if (stored !== undefined && !headers.has("if-none-match")) {
			headers.set("if-none-match", stored.etag);
		}
		const response = await fetchImpl(input, { ...init, headers });
		if (response.status === 304 && stored !== undefined) {
			const replayed = cachedHeaders(stored);
			response.headers.forEach((value, name) => {
				if (name === "etag" || name === "content-length") {
					return;
				}
				replayed.set(name, value);
			});
			const next = response.headers.get("etag");
			const etag = next !== null && next !== "" ? next : stored.etag;
			replayed.set("etag", etag);
			const kept = [...replayed.entries()];
			if (etag !== stored.etag || !sameHeaders(stored.headers, kept)) {
				cache.set(key, {
					etag,
					body: stored.body,
					headers: kept,
				});
				validators?.record(
					key,
					etag,
					JSON.stringify(stored.body),
					JSON.stringify(kept),
				);
			}
			return new Response(JSON.stringify(stored.body), {
				status: 200,
				headers: replayed,
			});
		}
		const next = response.headers.get("etag");
		if (response.ok && next !== null && next !== "") {
			const body: unknown = await response.clone().json();
			const kept = storedHeaders(response);
			cache.set(key, {
				etag: next,
				body,
				headers: kept,
			});
			validators?.record(key, next, JSON.stringify(body), JSON.stringify(kept));
		}
		return response;
	};
}
