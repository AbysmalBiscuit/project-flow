import { z } from "zod";

import type { ParameterValue, RunSettings } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type RunSettingsRead = RunSettings | "missing" | "not served";

const parameterValue: z.ZodType<ParameterValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(parameterValue),
		z.record(z.string(), parameterValue),
	]),
);

/** `GET /runs/{id}/settings`. */
const settings = z.object({
	workflow: z.string(),
	parameters: z.record(z.string(), parameterValue),
	parameters_error: z.string().nullable(),
	choices: z.record(
		z.string(),
		z.object({
			mode: z.string(),
			launcher: z.string().nullable(),
			harness: z.string().nullable(),
			model: z.string().nullable(),
			effort: z.string().nullable(),
			error: z.string().nullable(),
		}),
	),
	options: z.object({
		repo: z.string(),
		ticket: z.string(),
		author: z.string(),
		keep_worktree: z.boolean(),
		sent: z.boolean(),
		source: z.string().nullable(),
		rule: z.string().nullable(),
	}),
});

/**
 * The settings of a run, from the hub that reports the run, or else from its box.
 * The hub relays the read to the box.
 */
export function runSettingsReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	return async (runId: string): Promise<RunSettingsRead> => {
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
				)(`/runs/${encodeURIComponent(runId)}/settings`),
				settings,
			);
			const { keep_worktree, ...options } = found.options;
			return {
				workflowPackage: found.workflow,
				parameters: Object.entries(found.parameters).map(([name, value]) => ({
					name,
					value,
				})),
				parametersError: found.parameters_error,
				choices: Object.entries(found.choices).map(([node, choice]) => ({
					node,
					...choice,
				})),
				options: { ...options, keepWorktree: keep_worktree },
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
}
