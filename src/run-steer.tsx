import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery, useSteerRun } from "./queries.ts";
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
 * A steer box for a live run: Lev picks the stage, writes the text, and can interrupt the worker.
 * The stage follows the run's current stage until Lev edits it.
 */
export function RunSteer({ run }: { run: ShownFactoryRun }) {
	const { data: checkpoint } = useQuery(pageQuery.checkpoint(run));
	const [stageDraft, setStageDraft] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [interrupt, setInterrupt] = useState(false);
	const steer = useSteerRun(run.id);
	const checkpointStage =
		typeof checkpoint === "object" ? checkpoint.stage : null;
	const pickedStage = stageDraft ?? run.stage ?? checkpointStage ?? "";
	return (
		<section className={clsx(panel.section)} aria-label={steerLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{steerLabel}</h3>
			<form
				className={clsx(styles.steer)}
				data-run-steer={run.id}
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
				<label className={clsx(panel.label)} htmlFor="run-steer-stage">
					Stage
				</label>
				<input
					id="run-steer-stage"
					className={clsx(panel.text, styles.stage)}
					placeholder="The stage to steer"
					value={pickedStage}
					onChange={(event) => setStageDraft(event.target.value)}
				/>
				<textarea
					aria-label="Steer text"
					className={clsx(panel.text)}
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
				<Button
					label="Steer"
					submit
					tone="primary"
					layout={panel.send}
					disabled={steer.isPending}
				/>
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
