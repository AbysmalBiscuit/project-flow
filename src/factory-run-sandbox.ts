import { z } from "zod";

import type { RunSandbox } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

/** The box waits up to 5 seconds for its git remote to name the base branch, and then reads the worktree. */
const sandboxLimitMs = 15_000;

export type SandboxRead = RunSandbox | "missing" | "not served";

/** `GET /runs/{id}/sandbox`. */
const sandbox = z.object({
	host: z.string(),
	worktree: z.string().nullable(),
	branch: z.string().nullable(),
	head: z.string().nullable(),
	base: z.string().nullable(),
	ahead: z.number().nullable(),
	state: z.enum(["none", "removed", "clean", "dirty"]),
	changes: z.array(z.string()),
}) satisfies z.ZodType<RunSandbox>;

/**
 * The sandbox of a run, from the hub that reports the run, or else from its box.
 * The hub relays the read to the box.
 */
export function runSandboxReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	return async (runId: string): Promise<SandboxRead> => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal, sandboxLimitMs);
		try {
			return await body(
				await read(`/runs/${encodeURIComponent(runId)}/sandbox`),
				sandbox,
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
