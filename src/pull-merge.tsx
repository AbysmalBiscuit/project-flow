import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { AwaitingPull } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useMergePull } from "./queries.ts";
import { pullMergeCopy } from "./terms.ts";
import { clsx } from "./ui.ts";

/** Merge for one awaiting PR, with its confirm step. A closed gate and a forge refusal show their reason. */
export function PullMerge({ pull }: { pull: AwaitingPull }) {
	const [asking, setAsking] = useState(false);
	const merge = useMergePull();
	if (!pull.actions.includes("merge")) {
		return null;
	}
	const blocked = pull.mergeGate.open ? null : pull.mergeGate.reason;
	return (
		<div className={clsx(panel.runAction)} data-pull-merge={pull.number}>
			<Button
				label={
					merge.isPending
						? pullMergeCopy.merging
						: pullMergeCopy.merge(pull.number)
				}
				tone="primary"
				disabled={blocked !== null || merge.isPending}
				onClick={() => setAsking(true)}
			/>
			{blocked === null ? null : (
				<p className={clsx(panel.note)} data-merge-blocked={pull.number}>
					{blocked}
				</p>
			)}
			{merge.error === null ? null : (
				<p className={clsx(panel.error)} data-merge-refused={pull.number}>
					{merge.error.message}
				</p>
			)}
			<ConfirmDialog
				id={`pull-merge-dialog-${pull.number}`}
				open={asking}
				title={pullMergeCopy.title}
				body={pullMergeCopy.body(pull.number, pull.title, pull.baseBranch)}
				confirmLabel={pullMergeCopy.confirm}
				dismissLabel={pullMergeCopy.dismiss}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					merge.mutate(pull.url);
				}}
			/>
		</div>
	);
}
