import { z } from "zod";

import type { RunFile } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { SandboxRead } from "./factory-run-sandbox.ts";
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

/**
 * The files that a run's branch changed since it left its base, from the hub
 * that reports the run, or else from its box. The hub relays the read to the box.
 * The factory answers 404 both for a route that it does not serve and for a run
 * whose worktree is gone, so a 404 asks the run sandbox which one it is.
 */
export function runFilesReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
	sandbox: (runId: string) => Promise<SandboxRead>;
}) {
	const { fetchImpl, signal, statusRowOf, sandbox } = deps;
	return async (runId: string): Promise<FilesRead> => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		try {
			const found = await body(
				await reader(
					fetchImpl,
					target.url,
					signal,
				)(`/runs/${encodeURIComponent(runId)}/files`),
				files,
			);
			return found.files.map(({ previous_path, ...file }) =>
				previous_path === undefined
					? file
					: { ...file, previousPath: previous_path },
			);
		} catch (error) {
			if (error instanceof NotServed) {
				const found = await sandbox(runId);
				return typeof found === "object" && found.state === "removed"
					? "gone"
					: "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
}
