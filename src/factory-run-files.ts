import { z } from "zod";

import type { RunFile } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type FilesRead = RunFile[] | "missing" | "gone" | "not served";

/** `GET /runs/{id}/files`. */
const files = z.object({
	files: z.array(
		z.object({
			path: z.string(),
			previous_path: z.string().optional(),
			status: z.enum(["added", "modified", "deleted", "renamed"]),
			additions: z.number(),
			deletions: z.number(),
			patch: z.string(),
		}),
	),
});

/** The factory answers 404 with this error when the run's worktree is gone, such as after the run succeeded. */
const goneWorktree = z.object({
	error: z.string().regex(/^the worktree of run .* is gone$/),
});

/**
 * The files that a run's branch changed since it left its base, from the hub
 * that reports the run, or else from its box. The hub relays the read to the box.
 */
export function runFilesReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	return async (runId: string): Promise<FilesRead> => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		try {
			const response = await reader(
				fetchImpl,
				target.url,
				signal,
			)(`/runs/${encodeURIComponent(runId)}/files`);
			if (
				response.status === 404 &&
				goneWorktree.safeParse(
					await response
						.clone()
						.json()
						.catch(() => null),
				).success
			) {
				return "gone";
			}
			const found = await body(response, files);
			return found.files.map(({ previous_path, ...file }) =>
				previous_path === undefined
					? file
					: { ...file, previousPath: previous_path },
			);
		} catch (error) {
			if (error instanceof NotServed) {
				return "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
}
