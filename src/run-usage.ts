import type { RunUsage, TurnUsage } from "./domain.ts";

/**
 * One recorded agent turn of a run, at the node path of its worker, with the
 * harness and model that ran it. Null when the factory does not name them.
 */
export type RecordedTurn = {
	nodePath: string;
	harness: string | null;
	model: string | null;
	usage: TurnUsage;
};

const noUsage: TurnUsage = {
	inputTokens: 0,
	outputTokens: 0,
	costUsd: 0,
	durationS: 0,
	tools: {},
};

function added(left: TurnUsage, right: TurnUsage): TurnUsage {
	const tools = { ...left.tools };
	for (const [tool, count] of Object.entries(right.tools)) {
		tools[tool] = (tools[tool] ?? 0) + count;
	}
	return {
		inputTokens: left.inputTokens + right.inputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		costUsd: left.costUsd + right.costUsd,
		durationS: left.durationS + right.durationS,
		tools,
	};
}

/**
 * The usage of each run stage and of the run. A turn of a child graph node
 * counts toward the stage that calls the child graph. Null for a run with no turns.
 */
export function runUsage(turns: readonly RecordedTurn[]): RunUsage | null {
	if (turns.length === 0) {
		return null;
	}
	const stages: Record<string, TurnUsage> = {};
	for (const turn of turns) {
		const stage = turn.nodePath.split("/")[0] ?? turn.nodePath;
		stages[stage] = added(stages[stage] ?? noUsage, turn.usage);
	}
	return {
		stages,
		total: turns.reduce((sum, turn) => added(sum, turn.usage), noUsage),
	};
}
