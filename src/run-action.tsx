import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { ShownFactoryRun } from "./domain.ts";
import { endedRunStatusKinds } from "./kinds.ts";
import { panel } from "./panel-styles.ts";
import { MergeButton } from "./pull-merge.tsx";
import { useCancelRun, useStartAgain } from "./run-mutations.ts";
import { SplitButton, type SplitChoice } from "./split-button.tsx";
import { pullMergeCopy, runCancelCopy, runResumeCopy } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";

/**
 * The one action button of a run: Resume with its menu for a resumable run, else Cancel run.
 * A resumable run that has not ended offers Cancel run in the menu. Lev confirms each cancel and restart.
 */
export function RunAction({
	run,
	mergeChoices = [],
}: {
	run: Pick<ShownFactoryRun, "id" | "statusKind" | "resumable">;
	mergeChoices?: readonly SplitChoice[];
}) {
	const [asking, setAsking] = useState<"restart" | "cancel" | null>(null);
	const start = useStartAgain(run.id);
	const cancel = useCancelRun(run.id);
	const cancellable = !endedRunStatusKinds.some(
		(kind) => kind === run.statusKind,
	);
	if (run.resumable !== true && !cancellable) {
		return <MergeButton choices={mergeChoices} />;
	}
	const pending = start.isPending || cancel.isPending;
	const cancelLabel = cancel.isPending
		? runCancelCopy.pending
		: runCancelCopy.action;
	const choices: SplitChoice[] = [
		{
			label: runResumeCopy.fromCheckpoint,
			disabled: pending,
			onPick: () => start.mutate("resume"),
		},
		{
			label: runResumeCopy.fromBeginning,
			disabled: pending,
			onPick: () => setAsking("restart"),
		},
	];
	if (cancellable) {
		choices.push({
			label: cancelLabel,
			tone: "danger",
			disabled: pending,
			onPick: () => setAsking("cancel"),
		});
	}
	choices.push(...mergeChoices);
	return (
		<div className={clsx(panel.runAction)} data-run-action={run.id}>
			{run.resumable === true ? (
				<SplitButton
					label={start.isPending ? runResumeCopy.pending : runResumeCopy.action}
					choicesLabel={runResumeCopy.choices}
					tone="primary"
					disabled={pending}
					onClick={() => start.mutate("resume")}
					choices={choices}
				/>
			) : mergeChoices.length > 0 ? (
				<SplitButton
					label={cancelLabel}
					choicesLabel={pullMergeCopy.choices}
					tone="danger"
					disabled={pending}
					onClick={() => setAsking("cancel")}
					choices={mergeChoices}
				/>
			) : (
				<Button
					label={cancelLabel}
					tone="danger"
					disabled={pending}
					onClick={() => setAsking("cancel")}
				/>
			)}
			{start.error === null ? null : (
				<Toast
					tone="error"
					message={`${start.variables === "restart" ? runResumeCopy.restartFailed : runResumeCopy.resumeFailed}: ${start.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => start.reset()}
				/>
			)}
			{cancel.error === null ? null : (
				<Toast
					tone="error"
					message={`${runCancelCopy.failed}: ${cancel.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => cancel.reset()}
				/>
			)}
			<ConfirmDialog
				id={`run-restart-dialog-${run.id}`}
				open={asking === "restart"}
				title={runResumeCopy.title}
				body={
					run.statusKind === "blocked"
						? runResumeCopy.bodyBlocked
						: runResumeCopy.body
				}
				confirmLabel={runResumeCopy.confirm}
				dismissLabel={runResumeCopy.dismiss}
				onCancel={() => setAsking(null)}
				onConfirm={() => {
					setAsking(null);
					start.mutate("restart");
				}}
			/>
			<ConfirmDialog
				id={`run-cancel-dialog-${run.id}`}
				open={asking === "cancel"}
				title={runCancelCopy.title}
				body={runCancelCopy.body}
				confirmLabel={runCancelCopy.action}
				dismissLabel={runCancelCopy.dismiss}
				onCancel={() => setAsking(null)}
				onConfirm={() => {
					setAsking(null);
					cancel.mutate();
				}}
			/>
		</div>
	);
}
