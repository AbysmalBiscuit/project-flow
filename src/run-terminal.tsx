import { useQuery } from "@tanstack/react-query";

import type { ShownFactoryRun } from "./domain.ts";
import { liveRunStatusKinds } from "./kinds.ts";
import { Loading } from "./loading.tsx";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { stageAt } from "./run-agent-stage.ts";
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
		(typeof checkpoint === "object" ? checkpoint.lastAgentStage : null);
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
	const visits =
		typeof checkpoint === "object"
			? ((checkpoint.graph === null
					? undefined
					: stageAt(checkpoint.graph, stage)?.visits) ??
				checkpoint.visits[stage] ??
				0)
			: 0;
	return (
		<TerminalStage
			key={stage}
			run={run}
			stage={stage}
			following={live && stage === currentStage}
			visit={stageVisit(run.statusKind, visits)}
		/>
	);
}
