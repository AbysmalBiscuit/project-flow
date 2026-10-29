import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { RemoveAction, Steer } from "./factory-run-actions.ts";
import { openPage, runPagePath, runsPath } from "./page-links.ts";
import { pageQuery } from "./queries.ts";

/**
 * Add the ready label of a factory to a ticket, so the hub starts a run of it.
 * A named factory claims the ticket instead, and starts or queues the run.
 */
export function useStartRun(tracker: string, project: string, key: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (factory?: string): Promise<void> => {
			const response = await fetch("/api/run-starts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker,
					project,
					key,
					...(factory === undefined ? {} : { factory }),
				}),
			});
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Start failed");
			}
		},
		onSuccess: () => queries.invalidateQueries({ queryKey: ["project"] }),
	});
}

export function useAnswerQuestion(run: string, question: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (text: string): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/questions/${encodeURIComponent(question)}/answer`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text }),
				},
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Answer failed");
			}
		},
		onSuccess: () => {
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

export function useSteerRun(run: string) {
	return useMutation({
		mutationFn: async (steer: Steer): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/steer`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(steer),
				},
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Steer failed");
			}
		},
	});
}

export function useCancelRun(run: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/cancel`,
				{ method: "POST" },
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Cancel failed");
			}
		},
		onSuccess: () => {
			void queries.invalidateQueries(pageQuery.run(run));
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

/** Resume or restart a blocked or failed run. A restart opens the run page of the new run. */
export function useStartAgain(run: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (action: "resume" | "restart"): Promise<string> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/${action}`,
				{ method: "POST" },
			);
			const answer = (await response.json().catch(() => null)) as {
				id?: string;
				error?: string;
			} | null;
			if (!response.ok || answer?.id === undefined) {
				throw new Error(answer?.error ?? "The factory did not start the run");
			}
			return answer.id;
		},
		onSuccess: (id) => {
			void queries.invalidateQueries(pageQuery.run(run));
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
			if (id !== run) {
				openPage(runPagePath(id));
			}
		},
	});
}

/** Delete or archive an ended run. A delete from the run page opens the Runs list. */
export function useRemoveRun(run: string) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (action: RemoveAction): Promise<void> => {
			const response = await fetch(
				`/api/factory-runs/${encodeURIComponent(run)}/${action}`,
				{ method: "POST" },
			);
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(
					failed?.error ?? `The factory did not take the ${action}`,
				);
			}
		},
		onSuccess: (_done, action) => {
			void queries.invalidateQueries(pageQuery.runs);
			void queries.invalidateQueries({ queryKey: ["project"] });
			if (action === "archive") {
				void queries.invalidateQueries(pageQuery.run(run));
			} else if (window.location.pathname === runPagePath(run)) {
				openPage(runsPath);
			}
		},
	});
}
