import type { RunGraph, RunStage } from "./domain.ts";

/** Each call of a child graph opens at one of these start nodes, which run no agent. */
export const startNodes: ReadonlySet<string> = new Set(["start", "Start"]);

/** The stage at `path` in the graph: a top-level stage, or a stage of a child graph. */
export function stageAt(graph: RunGraph, path: string): RunStage | undefined {
	return (
		graph.nodes.find((node) => node.id === path) ??
		graph.nodes
			.flatMap((node) => node.child ?? [])
			.find((stage) => stage.id === path)
	);
}

/**
 * True when the stage at `path` records a transcript: an agent stage that
 * calls no child graph, or a stage of a child graph other than its start.
 */
function hasTranscript(graph: RunGraph, path: string): boolean {
	const node = graph.nodes.find((candidate) => candidate.id === path);
	if (node !== undefined) {
		return node.kind === "codergen" && node.child === undefined;
	}
	const stage = stageAt(graph, path);
	return stage !== undefined && !startNodes.has(stage.label);
}

/**
 * The stage whose transcript a view of a run shows when it follows no live
 * stage. It is the stage where the run is or stopped, when that stage records
 * a transcript. Else it is the last finished stage that records one, and a
 * node that calls a child graph gives the last stage of that child graph.
 *
 * With no graph, a run that succeeded stopped at its exit, so it gives its
 * last finished stage. Each other run gives the stage where it is or stopped.
 */
export function lastAgentStage(run: {
	stage: string | null;
	completedStages: string[];
	graph: RunGraph | null;
	succeeded: boolean;
}): string | null {
	const { stage, completedStages, graph, succeeded } = run;
	if (graph === null) {
		return (succeeded ? null : stage) ?? completedStages.at(-1) ?? null;
	}
	if (stage !== null && hasTranscript(graph, stage)) {
		return stage;
	}
	for (const id of completedStages.toReversed()) {
		const node = graph.nodes.find((candidate) => candidate.id === id);
		const last =
			node?.child === undefined
				? node?.id
				: node.child.findLast((child) => !startNodes.has(child.label))?.id;
		if (last !== undefined && hasTranscript(graph, last)) {
			return last;
		}
	}
	return null;
}
