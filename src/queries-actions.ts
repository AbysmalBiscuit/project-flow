import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { PostedReply, TrackerKind } from "./domain.ts";
import { pullMergeCopy, requestChangesCopy } from "./pull-terms.ts";
import { pageQuery } from "./queries-page.ts";

type ReplyBody = {
	tracker: TrackerKind;
	project: string;
	key: string;
	host?: string;
	body?: string;
	option?: number;
	parentId?: string;
	kind?: "comment" | "review";
};

export function usePostReply(
	tracker: string,
	project: string,
	key: string,
	host?: string,
) {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (body: ReplyBody): Promise<PostedReply> => {
			const response = await fetch("/api/replies", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? "Reply failed");
			}
			return (await response.json()) as PostedReply;
		},
		onSuccess: async () => {
			await queries.invalidateQueries(
				pageQuery.thread(tracker, project, key, host),
			);
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

/** Merge one awaiting PR. The server reads its project again before it answers. */
export function useMergePull() {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (url: string): Promise<void> => {
			const response = await fetch("/api/pulls/merge", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ url }),
			});
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? pullMergeCopy.failed);
			}
		},
		onSuccess: () => {
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
		},
	});
}

/** Send a review that asks for changes on one awaiting PR. The server reads its project again before it answers. */
export function useRequestChanges() {
	const queries = useQueryClient();
	return useMutation({
		mutationFn: async (review: {
			url: string;
			body: string;
		}): Promise<void> => {
			const response = await fetch("/api/pulls/request-changes", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(review),
			});
			if (!response.ok) {
				const failed = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(failed?.error ?? requestChangesCopy.failed);
			}
		},
		onSuccess: () => {
			void queries.invalidateQueries(pageQuery.needsYou);
			void queries.invalidateQueries({ queryKey: ["project"] });
			void queries.invalidateQueries({ queryKey: ["thread"] });
		},
	});
}

/** Read one project again. The event stream brings its new rows when the read ends. */
export function useRefreshProject(name: string) {
	return useMutation({
		mutationFn: async (): Promise<void> => {
			const response = await fetch(
				`/api/projects/${encodeURIComponent(name)}/refresh`,
				{ method: "POST" },
			);
			if (!response.ok) {
				throw new Error(`refresh failed (HTTP ${response.status})`);
			}
		},
	});
}
