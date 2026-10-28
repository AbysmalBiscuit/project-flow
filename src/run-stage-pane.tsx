import * as stylex from "@stylexjs/stylex";

import { Button } from "./button.tsx";
import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { StageView, steerTarget } from "./run-stage-view.tsx";
import type { StageFacts } from "./run-stage.tsx";
import { RunSteer, useCurrentStage } from "./run-steer.tsx";
import {
	closeStagePaneLabel,
	openInStagesLabel,
	stagePaneLabel,
} from "./terms.ts";
import { colours, measure, radius, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	pane: {
		display: "flex",
		flexDirection: "column",
		flexShrink: 0,
		gap: space.sm,
		boxSizing: "border-box",
		width: measure.stagePane,
		maxWidth: "100%",
		maxHeight: measure.runGraph,
		padding: space.md,
		overflowY: "auto",
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	head: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: space.sm,
	},
});

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
		<aside
			className={clsx(styles.pane)}
			aria-label={stagePaneLabel}
			data-stage-pane={stage}
		>
			<div className={clsx(styles.head)}>
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
				<Button icon="x" name={closeStagePaneLabel} onClick={onClose} />
			</div>
			<StageView run={run} facts={facts} />
			{target === null ? null : <RunSteer run={run} stage={target} />}
		</aside>
	);
}
