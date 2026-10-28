import { useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useStartAgain } from "./queries.ts";
import { SplitButton } from "./split-button.tsx";
import { runResumeCopy } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";

/**
 * Resume for a resumable run. The main part resumes the run from its run checkpoint.
 * The menu also offers a restart from the first stage, which Lev confirms.
 */
export function RunResume({
	run,
}: {
	run: Pick<ShownFactoryRun, "id" | "statusKind" | "resumable">;
}) {
	const [asking, setAsking] = useState(false);
	const start = useStartAgain(run.id);
	if (run.resumable !== true) {
		return null;
	}
	return (
		<div className={clsx(panel.runAction)} data-run-resume={run.id}>
			<SplitButton
				label={start.isPending ? runResumeCopy.pending : runResumeCopy.action}
				choicesLabel={runResumeCopy.choices}
				tone="primary"
				disabled={start.isPending}
				onClick={() => start.mutate("resume")}
				choices={[
					{
						label: runResumeCopy.fromCheckpoint,
						onPick: () => start.mutate("resume"),
					},
					{
						label: runResumeCopy.fromBeginning,
						onPick: () => setAsking(true),
					},
				]}
			/>
			{start.error === null ? null : (
				<Toast
					tone="error"
					message={`${start.variables === "restart" ? runResumeCopy.restartFailed : runResumeCopy.resumeFailed}: ${start.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => start.reset()}
				/>
			)}
			<ConfirmDialog
				id={`run-restart-dialog-${run.id}`}
				open={asking}
				title={runResumeCopy.title}
				body={
					run.statusKind === "blocked"
						? runResumeCopy.bodyBlocked
						: runResumeCopy.body
				}
				confirmLabel={runResumeCopy.confirm}
				dismissLabel={runResumeCopy.dismiss}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					start.mutate("restart");
				}}
			/>
		</div>
	);
}
