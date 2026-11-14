import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { StageView, steerTarget } from "./run-stage-view.tsx";
import type { StageFacts } from "./run-stage.tsx";
import { RunSteer, useCurrentStage } from "./run-steer.tsx";
import { SidePane } from "./side-pane.tsx";
import {
	closeStagePaneLabel,
	openInStagesLabel,
	stagePaneLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";

/**
 * The pane beside the run graph that shows one stage in the stage view. A live
 * stage adds a steer box for that stage while the run is still there.
 */
export function StagePane({
	run,
	facts,
	onClose,
	onOpenStage,
}: {
	run: ShownFactoryRun;
	facts: StageFacts;
	onClose: () => void;
	onOpenStage: (stage: string) => void;
}) {
	const stage = facts.stage.id;
	const target = steerTarget(run, facts, useCurrentStage(run));
	const query = new URLSearchParams({ tab: "stages", stage }).toString();
	return (
		<SidePane
			label={stagePaneLabel}
			closeLabel={closeStagePaneLabel}
			onClose={onClose}
			data-stage-pane={stage}
			head={
				<a
					className={clsx(panel.factLink)}
					href={`?${query}`}
					onClick={(event) => {
						event.preventDefault();
						onOpenStage(stage);
					}}
				>
					{openInStagesLabel}
				</a>
			}
		>
			<StageView run={run} facts={facts} />
			{target === null ? null : <RunSteer run={run} stage={target} />}
		</SidePane>
	);
}
