import { QueryClient } from "@tanstack/react-query";

const pageStaleTimeMs = 60_000;

export const pageQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// 60 seconds keeps a query fresh across client navigation.
			staleTime: pageStaleTimeMs,
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	},
});

export async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`${path} failed (HTTP ${response.status})`);
	}
	return (await response.json()) as T;
}

/** A read that the app has not answered yet keeps what the page holds. */
export function heldData<T>(queryKey: readonly unknown[]): T | undefined {
	return pageQueryClient.getQueryData<T>(queryKey);
}
