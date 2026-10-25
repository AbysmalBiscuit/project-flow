import { useQuery } from "@tanstack/react-query";

import type { RunCheckpoint, ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import {
	currentStageLabel,
	runStagesLabel,
	stageRetriesLabel,
	stageVisitsLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";

/** Each stage once, in the order the run first reached it, then the current stage. */
function stagesOf(checkpoint: RunCheckpoint): string[] {
	const current = checkpoint.stage?.split("/")[0];
	return [
		...new Set([
			...checkpoint.completedStages,
			...(current === undefined ? [] : [current]),
		]),
	];
}

/** The stages of a factory run from its run checkpoint, with the visits and retries of each. */
export function RunStages({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.checkpoint(run));
	if (data === undefined || data === null) {
		return null;
	}
	const current = data.stage?.split("/")[0];
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runStagesLabel}</h3>
			<ul className={clsx(panel.relations)} aria-label={runStagesLabel}>
				{stagesOf(data).map((stage) => {
					const visits = data.visits[stage] ?? 0;
					const retries = data.retries[stage] ?? 0;
					const isCurrent = stage === current;
					return (
						<li
							key={stage}
							className={clsx(panel.relation, isCurrent && panel.currentStage)}
							data-stage={stage}
							aria-current={isCurrent ? "step" : undefined}
						>
							<span>{isCurrent ? (data.stage ?? stage) : stage}</span>
							{isCurrent ? (
								<span className={clsx(panel.key)}>{currentStageLabel}</span>
							) : null}
							{visits === 0 ? null : (
								<span className={clsx(panel.key)}>
									{stageVisitsLabel(visits)}
								</span>
							)}
							{retries === 0 ? null : (
								<span className={clsx(panel.key)}>
									{stageRetriesLabel(retries)}
								</span>
							)}
						</li>
					);
				})}
			</ul>
		</>
	);
}
