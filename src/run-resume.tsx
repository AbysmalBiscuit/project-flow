import { useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { RunStatusKind, ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useStartAgain } from "./queries.ts";
import { SplitButton } from "./split-button.tsx";
import { runResumeCopy } from "./terms.ts";
import { clsx } from "./ui.ts";

const resumableKinds = [
	"blocked",
	"failed",
] as const satisfies readonly RunStatusKind[];

/**
 * Resume for a blocked or failed run. The main part resumes the run from its run checkpoint.
 * The menu also offers a restart from the first stage, which Lev confirms.
 */
export function RunResume({
	run,
}: {
	run: Pick<ShownFactoryRun, "id" | "statusKind">;
}) {
	const [asking, setAsking] = useState(false);
	const start = useStartAgain(run.id);
	if (!resumableKinds.some((kind) => kind === run.statusKind)) {
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
				<p className={clsx(panel.error)}>{start.error.message}</p>
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
