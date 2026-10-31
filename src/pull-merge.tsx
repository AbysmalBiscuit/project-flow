import { type ReactNode, useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { AwaitingPull } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useMergePull } from "./queries.ts";
import { SplitButton, type SplitChoice } from "./split-button.tsx";
import { pullMergeCopy } from "./terms.ts";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";

/**
 * The Merge choices of the run control, one for each PR that its forge can merge.
 * A closed gate gives a disabled choice that names its reason. `feedback` holds
 * the confirm step and the refusal message of the forge.
 */
export function usePullMerge(
	pulls: readonly AwaitingPull[],
	onMerged: (() => void) | undefined,
): { choices: SplitChoice[]; feedback: ReactNode } {
	const [asking, setAsking] = useState<AwaitingPull | null>(null);
	const merge = useMergePull();
	const choices = pulls
		.filter((pull) => pull.actions.includes("merge"))
		.map((pull): SplitChoice => ({
			label: pull.mergeGate.open
				? merge.isPending && merge.variables === pull.url
					? pullMergeCopy.merging
					: pullMergeCopy.merge(pull.number)
				: pullMergeCopy.blocked(pull.number, pull.mergeGate.reason),
			disabled: !pull.mergeGate.open || merge.isPending,
			independent: true,
			onPick: () => setAsking(pull),
		}));
	const feedback = (
		<>
			{merge.error === null ? null : (
				<Toast
					tone="error"
					message={`${pullMergeCopy.failed}: ${merge.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => merge.reset()}
				/>
			)}
			<ConfirmDialog
				id="pull-merge-dialog"
				open={asking !== null}
				title={pullMergeCopy.title}
				body={
					asking === null
						? ""
						: pullMergeCopy.body(asking.number, asking.title, asking.baseBranch)
				}
				confirmLabel={pullMergeCopy.confirm}
				dismissLabel={pullMergeCopy.dismiss}
				onCancel={() => setAsking(null)}
				onConfirm={() => {
					if (asking !== null) {
						merge.mutate(
							asking.url,
							onMerged === undefined ? {} : { onSuccess: onMerged },
						);
					}
					setAsking(null);
				}}
			/>
		</>
	);
	return { choices, feedback };
}

/** The run control of a ticket with no run action: only its Merge choices. */
export function MergeButton({ choices }: { choices: readonly SplitChoice[] }) {
	const [only] = choices;
	if (only === undefined) {
		return null;
	}
	return (
		<div className={clsx(panel.runAction)} data-pull-merge="true">
			{choices.length === 1 ? (
				<Button
					label={only.label}
					tone="primary"
					disabled={only.disabled === true}
					onClick={only.onPick}
				/>
			) : (
				<SplitButton
					label={pullMergeCopy.menu}
					choicesLabel={pullMergeCopy.choices}
					tone="primary"
					choices={choices}
				/>
			)}
		</div>
	);
}
