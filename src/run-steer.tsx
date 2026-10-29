import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { board } from "./board-styles.ts";
import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery, useSteerRun } from "./queries.ts";
import { blurOnEscape, SendButton, SendText } from "./send-box.tsx";
import { steerFailed, steerLabel } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	steer: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
	},
	stage: {
		minHeight: 0,
		resize: "none",
	},
	interrupt: {
		justifyContent: "flex-start",
	},
});

/**
 * The path of the stage where the run is now. The run's stage from the event
 * feed comes first, because the checkpoint read keeps its last answer until a
 * new read lands.
 */
export function useCurrentStage(run: ShownFactoryRun): string | null {
	const { data: checkpoint } = useQuery(pageQuery.checkpoint(run));
	return (
		run.stage ?? (typeof checkpoint === "object" ? checkpoint.stage : null)
	);
}

/**
 * A steer box for a live run: Lev picks the stage, writes the text, and can interrupt the worker.
 * The stage follows the run's current stage until Lev edits it. A box with a
 * fixed `stage` steers only that stage, and has no stage field.
 */
export function RunSteer({
	run,
	stage,
}: {
	run: ShownFactoryRun;
	stage?: string;
}) {
	const currentStage = useCurrentStage(run);
	const [stageDraft, setStageDraft] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [interrupt, setInterrupt] = useState(false);
	const steer = useSteerRun(run.id);
	const pickedStage = stage ?? stageDraft ?? currentStage ?? "";
	return (
		<section className={clsx(panel.section)} aria-label={steerLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{steerLabel}</h3>
			<form
				className={clsx(styles.steer)}
				data-run-steer={run.id}
				data-steer-stage={pickedStage}
				onSubmit={(event) => {
					event.preventDefault();
					if (pickedStage.trim() === "" || text.trim() === "") {
						return;
					}
					steer.mutate(
						{ stage: pickedStage, text, interrupt },
						{
							onSuccess: () => {
								setText("");
								setInterrupt(false);
							},
						},
					);
				}}
			>
				{stage === undefined ? (
					<>
						<label className={clsx(panel.label)} htmlFor="run-steer-stage">
							Stage
						</label>
						<input
							id="run-steer-stage"
							className={clsx(panel.text, styles.stage)}
							placeholder="The stage to steer"
							value={pickedStage}
							onChange={(event) => setStageDraft(event.target.value)}
							onKeyDown={blurOnEscape}
						/>
					</>
				) : null}
				<SendText
					aria-label="Steer text"
					placeholder="Write a steer"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				<label className={clsx(board.menuRow, styles.interrupt)}>
					<input
						type="checkbox"
						className={clsx(board.check)}
						checked={interrupt}
						onChange={(event) => setInterrupt(event.target.checked)}
					/>
					<span>Interrupt the current turn</span>
				</label>
				<SendButton label="Steer" disabled={steer.isPending} />
				{steer.error === null ? null : (
					<Toast
						tone="error"
						message={`${steerFailed}: ${steer.error.message}`}
						hideMs={actionToastHideMs}
						onClose={() => steer.reset()}
					/>
				)}
			</form>
		</section>
	);
}
