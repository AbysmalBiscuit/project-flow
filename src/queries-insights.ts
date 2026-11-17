import { useMutation, useQueryClient } from "@tanstack/react-query";

import { pageQuery } from "./queries-page.ts";
import type { InsightResult } from "./run-history.ts";
import type { SavedInsight } from "./saved-insights.ts";

/** Run one SQL statement over the run history. A refused or failed query answers its error. */
export function useInsightQuery() {
	return useMutation({
		mutationFn: async (sql: string): Promise<InsightResult> => {
			const response = await fetch("/api/insights/query", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sql }),
			});
			const body = (await response
				.json()
				.catch(() => null)) as InsightResult | null;
			return body ?? { error: `query failed (HTTP ${response.status})` };
		},
	});
}

type SavedInsightChange =
	| { kind: "create"; name: string; sql: string }
	| { kind: "change"; id: number; name?: string; sql?: string }
	| { kind: "delete"; id: number };

function savedInsightRequest(
	change: SavedInsightChange,
): [string, RequestInit] {
	const json = { "content-type": "application/json" };
	switch (change.kind) {
		case "create":
			return [
				"/api/insights/saved",
				{
					method: "POST",
					headers: json,
					body: JSON.stringify({ name: change.name, sql: change.sql }),
				},
			];
		case "change":
			return [
				`/api/insights/saved/${change.id}`,
				{
					method: "PATCH",
					headers: json,
					body: JSON.stringify({ name: change.name, sql: change.sql }),
				},
			];
		case "delete":
			return [`/api/insights/saved/${change.id}`, { method: "DELETE" }];
	}
}

/** Create, change or delete a saved insight query. The answer is the saved query, or null after a delete. */
export function useSavedInsightChange() {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (
			change: SavedInsightChange,
		): Promise<SavedInsight | null> => {
			const response = await fetch(...savedInsightRequest(change));
			if (!response.ok) {
				const answer = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					answer?.error ?? `save failed (HTTP ${response.status})`,
				);
			}
			return change.kind === "delete"
				? null
				: ((await response.json()) as SavedInsight);
		},
		onSuccess: () => queries.invalidateQueries(pageQuery.savedInsights),
	});
}
