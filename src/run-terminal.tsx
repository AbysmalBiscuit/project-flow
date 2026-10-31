import { useQuery } from "@tanstack/react-query";

import type {
	RunCheckpoint,
	RunGraph,
	RunStage,
	ShownFactoryRun,
} from "./domain.ts";
import { liveRunStatusKinds } from "./kinds.ts";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { Transcript } from "./run-stage-view.tsx";
import { RunSteer, useCurrentStage } from "./run-steer.tsx";
import { stageVisit } from "./stage-queries.ts";
import { noTerminalStageLabel, terminalStageLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The stage at `path` in the graph: a top-level stage, or a stage of a child graph. */
function stageAt(graph: RunGraph | null, path: string): RunStage | undefined {
	return (
		graph?.nodes.find((node) => node.id === path) ??
		graph?.nodes
			.flatMap((node) => node.child ?? [])
			.find((stage) => stage.id === path)
	);
}

/**
 * The last stage that the run finished with an agent. A node that the graph
 * names with another handler, such as the exit, has no transcript.
 */
function lastAgentStage({ completedStages, graph }: RunCheckpoint) {
	return (
		completedStages.findLast((id) => {
			const kind = graph?.nodes.find((node) => node.id === id)?.kind;
			return kind === undefined || kind === "codergen";
		}) ?? null
	);
}

/**
 * The Terminal tab: the transcript of the stage where the run is now, and a
 * steer box for it. A run that has ended shows its last stage and no steer box.
 */
export function RunTerminal({ run }: { run: ShownFactoryRun }) {
	const { data: checkpoint } = useQuery(pageQuery.checkpoint(run));
	const currentStage = useCurrentStage(run);
	const live = liveRunStatusKinds.some((kind) => kind === run.statusKind);
	const stage =
		currentStage ??
		(typeof checkpoint === "object" ? lastAgentStage(checkpoint) : null);
	if (stage === null) {
		return <p className={clsx(panel.note)}>{noTerminalStageLabel}</p>;
	}
	return (
		<div data-run-terminal={stage} data-terminal-live={live}>
			<dl className={clsx(panel.facts)}>
				<RunFact label={terminalStageLabel}>{stage}</RunFact>
			</dl>
			<Transcript
				key={stage}
				runId={run.id}
				stage={stage}
				live={live}
				visit={stageVisit(
					run.statusKind,
					stageAt(
						typeof checkpoint === "object" ? checkpoint.graph : null,
						stage,
					)?.visits ?? 0,
				)}
				follow
			/>
			{live ? <RunSteer run={run} stage={stage} /> : null}
		</div>
	);
}
