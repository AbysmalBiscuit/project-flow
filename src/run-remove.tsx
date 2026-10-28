import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { endedRunStatusKinds, type FactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useRemoveRun } from "./queries.ts";
import { runRemoveCopy } from "./terms.ts";
import { space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	buttons: {
		display: "flex",
		gap: space.xs,
	},
});

/** Delete and Archive for an ended run. Delete asks Lev to confirm. An archived run offers only Delete. */
export function RunRemove({
	run,
}: {
	run: Pick<FactoryRun, "id" | "statusKind" | "archivedAt">;
}) {
	const [asking, setAsking] = useState(false);
	const remove = useRemoveRun(run.id);
	if (!endedRunStatusKinds.some((kind) => kind === run.statusKind)) {
		return null;
	}
	const pending = remove.isPending ? remove.variables : undefined;
	return (
		<div className={clsx(panel.runAction)} data-run-remove={run.id}>
			<div className={clsx(styles.buttons)}>
				{run.archivedAt === undefined ? (
					<Button
						label={
							pending === "archive"
								? runRemoveCopy.archiving
								: runRemoveCopy.archive
						}
						disabled={remove.isPending}
						onClick={() => remove.mutate("archive")}
					/>
				) : null}
				<Button
					label={
						pending === "delete" ? runRemoveCopy.deleting : runRemoveCopy.delete
					}
					tone="danger"
					disabled={remove.isPending}
					onClick={() => setAsking(true)}
				/>
			</div>
			{remove.error === null ? null : (
				<p className={clsx(panel.error)}>{remove.error.message}</p>
			)}
			<ConfirmDialog
				id={`run-delete-dialog-${run.id}`}
				open={asking}
				title={runRemoveCopy.title}
				body={runRemoveCopy.body}
				confirmLabel={runRemoveCopy.delete}
				dismissLabel={runRemoveCopy.dismiss}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					remove.mutate("delete");
				}}
			/>
		</div>
	);
}
