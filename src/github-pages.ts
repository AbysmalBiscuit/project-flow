import type { Fetch } from "./fetch.ts";
import { TrackerError } from "./ports.ts";

export function githubHeaders(token: string): Record<string, string> {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"x-github-api-version": "2022-11-28",
	};
}

export function nextPage(link: string | null): string | null {
	if (link === null) {
		return null;
	}
	for (const part of link.split(",")) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match?.[1] !== undefined) {
			return match[1];
		}
	}
	return null;
}

export function fetchWithSignal(
	fetchImpl: Fetch,
	input: string,
	init: RequestInit,
	signal: AbortSignal | undefined,
): Promise<Response> {
	if (signal === undefined) {
		return fetchImpl(input, init);
	}
	return fetchImpl(input, { ...init, signal });
}

export async function pages(
	start: string,
	token: string,
	fetchImpl: Fetch,
	repo: string,
	label: string,
	signal?: AbortSignal,
): Promise<unknown[]> {
	const bodies: unknown[] = [];
	let url: string | null = start;
	while (url !== null) {
		const response = await fetchWithSignal(
			fetchImpl,
			url,
			{
				headers: githubHeaders(token),
			},
			signal,
		);
		if (!response.ok) {
			throw new TrackerError(
				`GitHub ${label} failed (HTTP ${response.status}): ${repo}`,
				response.status,
			);
		}
		bodies.push(await response.json());
		url = nextPage(response.headers.get("link"));
	}
	return bodies;
}
