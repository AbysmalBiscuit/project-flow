import { useQuery } from "@tanstack/react-query";

import type {
	RunCheckpoint,
	RunGraph,
	RunStage,
	ShownFactoryRun,
} from "./domain.ts";
import { liveRunStatusKinds } from "./kinds.ts";
import { Loading } from "./loading.tsx";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import { Transcript } from "./run-stage-view.tsx";
import { RunSteer, useCurrentStage } from "./run-steer.tsx";
import { stageQuery, stageVisit } from "./stage-queries.ts";
import {
	noRunDataLabel,
	noTerminalStageLabel,
	runTabData,
	terminalStageLabel,
} from "./terms.ts";
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

/** Each call of a child graph opens at one of these start nodes, which run no agent. */
const startNodes = new Set(["start", "Start"]);

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
 * The last stage with a transcript that the run finished. A node that calls a
 * child graph gives the last stage of that child graph, by its full path.
 */
function lastTranscriptStage({
	completedStages,
	graph,
}: RunCheckpoint): string | null {
	if (graph === null) {
		return completedStages.at(-1) ?? null;
	}
	for (const id of completedStages.toReversed()) {
		const node = graph.nodes.find((candidate) => candidate.id === id);
		const stage =
			node?.child === undefined
				? node?.id
				: node.child.findLast((child) => !startNodes.has(child.label))?.id;
		if (stage !== undefined && hasTranscript(graph, stage)) {
			return stage;
		}
	}
	return null;
}

/**
 * The stage that the Terminal tab of a run with no live stage shows. A run that
 * failed or stopped shows the stage where it stopped. A run that succeeded
 * stopped at its exit, so it shows its last stage with a transcript.
 */
function endedStage(run: ShownFactoryRun, checkpoint: RunCheckpoint) {
	const { stage, graph } = checkpoint;
	const stoppedHere =
		stage !== null &&
		(graph === null
			? run.statusKind !== "succeeded"
			: hasTranscript(graph, stage));
	return stoppedHere ? stage : lastTranscriptStage(checkpoint);
}

/**
 * The transcript of one stage, and a steer box while the stage is the live
 * stage of the run and has not ended.
 */
function TerminalStage({
	run,
	stage,
	following,
	visit,
}: {
	run: ShownFactoryRun;
	stage: string;
	following: boolean;
	visit: string;
}) {
	const { data } = useQuery(
		stageQuery.transcript(run.id, stage, following, visit),
	);
	const ended = typeof data === "object" && data.ended;
	return (
		<div data-run-terminal={stage} data-terminal-live={following}>
			<dl className={clsx(panel.facts)}>
				<RunFact label={terminalStageLabel}>{stage}</RunFact>
			</dl>
			<Transcript
				runId={run.id}
				stage={stage}
				live={following}
				visit={visit}
				follow
			/>
			{following && !ended ? <RunSteer run={run} stage={stage} /> : null}
		</div>
	);
}

/**
 * The Terminal tab: the transcript of the stage where the run is now, and a
 * steer box for it. A run with no live stage shows its last stage and no
 * steer box.
 */
export function RunTerminal({ run }: { run: ShownFactoryRun }) {
	const { data: checkpoint } = useQuery(pageQuery.checkpoint(run));
	const currentStage = useCurrentStage(run);
	const live = liveRunStatusKinds.some((kind) => kind === run.statusKind);
	const stage =
		(live ? currentStage : null) ??
		(typeof checkpoint === "object" ? endedStage(run, checkpoint) : null);
	if (stage === null) {
		return checkpoint === undefined ? (
			<Loading />
		) : checkpoint === "not served" ? (
			<NotServed data={runTabData.stages} />
		) : (
			<p className={clsx(panel.note)}>
				{checkpoint === "missing" ? noRunDataLabel : noTerminalStageLabel}
			</p>
		);
	}
	const graph = typeof checkpoint === "object" ? checkpoint.graph : null;
	return (
		<TerminalStage
			key={stage}
			run={run}
			stage={stage}
			following={live && stage === currentStage}
			visit={stageVisit(run.statusKind, stageAt(graph, stage)?.visits ?? 0)}
		/>
	);
}
