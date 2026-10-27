import { z } from "zod";

import type { RunSource } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type SourceRead = RunSource | "missing" | "not served";

/** `GET /runs/{id}/source`: the text of each graph file, keyed by its path in the package. */
const source = z.object({
	entry: z.string(),
	graphs: z.record(z.string(), z.string()),
});

/**
 * The workflow source of a run, from the hub that reports the run, or else
 * from its box. The hub relays the read to the box.
 */
export function runSourceReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	const sourceOf = async (runId: string): Promise<SourceRead> => {
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
				)(`/runs/${encodeURIComponent(runId)}/source`),
				source,
			);
			const graphs = Object.entries(found.graphs).map(([path, text]) => ({
				path,
				text,
			}));
			return {
				entry: found.entry,
				graphs: graphs.toSorted(
					(a, b) =>
						Number(b.path === found.entry) - Number(a.path === found.entry),
				),
			};
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
	return { source: sourceOf };
}
