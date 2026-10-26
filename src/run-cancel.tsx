import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { endedRunStatusKinds, type ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useCancelRun } from "./queries.ts";
import { runCancelCopy } from "./terms.ts";
import { space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	cancel: {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		gap: space.xs,
	},
});

/** Cancel for a run that has not ended. Lev confirms, and the factory stops the run as failed. */
export function RunCancel({
	run,
}: {
	run: Pick<ShownFactoryRun, "id" | "statusKind">;
}) {
	const [asking, setAsking] = useState(false);
	const cancel = useCancelRun(run.id);
	if (endedRunStatusKinds.some((kind) => kind === run.statusKind)) {
		return null;
	}
	return (
		<div className={clsx(styles.cancel)} data-run-cancel={run.id}>
			<Button
				label={cancel.isPending ? runCancelCopy.pending : runCancelCopy.action}
				tone="danger"
				disabled={cancel.isPending}
				onClick={() => setAsking(true)}
			/>
			{cancel.error === null ? null : (
				<p className={clsx(panel.error)}>{cancel.error.message}</p>
			)}
			<ConfirmDialog
				id={`run-cancel-dialog-${run.id}`}
				open={asking}
				title={runCancelCopy.title}
				body={runCancelCopy.body}
				confirmLabel={runCancelCopy.action}
				dismissLabel={runCancelCopy.dismiss}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					cancel.mutate();
				}}
			/>
		</div>
	);
}
