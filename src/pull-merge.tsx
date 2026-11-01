import { type ReactNode, useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { AwaitingPull } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pullMergeCopy, requestChangesCopy } from "./pull-terms.ts";
import { useMergePull, useRequestChanges } from "./queries.ts";
import { SendText } from "./send-box.tsx";
import { SplitButton, type SplitChoice } from "./split-button.tsx";
import { actionToastHideMs, Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";

/**
 * The PR choices of the run control: Merge for each PR that its forge can
 * merge, then Request changes for each PR that its forge can review. A closed
 * gate gives a disabled Merge that names its reason. `feedback` holds the
 * confirm step, the review text field and the refusal message of the forge.
 */
export function usePullMerge(
	pulls: readonly AwaitingPull[],
	onMerged: (() => void) | undefined,
): { choices: SplitChoice[]; feedback: ReactNode } {
	const [asking, setAsking] = useState<AwaitingPull | null>(null);
	const [reviewing, setReviewing] = useState<AwaitingPull | null>(null);
	const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
	const draft = reviewing === null ? "" : (drafts[reviewing.url] ?? "");
	const setDraft = (url: string, text: string) =>
		setDrafts((all) => ({ ...all, [url]: text }));
	const merge = useMergePull();
	const review = useRequestChanges();
	const mergeChoices = pulls
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
	const reviewChoices = pulls
		.filter((pull) => pull.actions.includes("requestChanges"))
		.map((pull): SplitChoice => ({
			label:
				review.isPending && review.variables?.url === pull.url
					? requestChangesCopy.sending
					: requestChangesCopy.action(pull.number),
			disabled: review.isPending,
			independent: true,
			onPick: () => setReviewing(pull),
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
			{review.error === null ? null : (
				<Toast
					tone="error"
					message={`${requestChangesCopy.failed}: ${review.error.message}`}
					hideMs={actionToastHideMs}
					onClose={() => review.reset()}
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
			<ConfirmDialog
				id="pull-review-dialog"
				open={reviewing !== null}
				title={requestChangesCopy.title}
				body={
					reviewing === null
						? ""
						: requestChangesCopy.body(reviewing.number, reviewing.title)
				}
				confirmLabel={requestChangesCopy.confirm}
				dismissLabel={requestChangesCopy.dismiss}
				confirmDisabled={draft.trim() === ""}
				onCancel={() => setReviewing(null)}
				onConfirm={() => {
					if (reviewing !== null) {
						const { url } = reviewing;
						review.mutate(
							{ url, body: draft },
							{ onSuccess: () => setDraft(url, "") },
						);
					}
					setReviewing(null);
				}}
			>
				<label className={clsx(panel.label)} htmlFor="pull-review-text">
					{requestChangesCopy.label}
				</label>
				<SendText
					id="pull-review-text"
					placeholder={requestChangesCopy.placeholder}
					value={draft}
					onChange={(event) => {
						if (reviewing !== null) {
							setDraft(reviewing.url, event.target.value);
						}
					}}
				/>
			</ConfirmDialog>
		</>
	);
	return { choices: [...mergeChoices, ...reviewChoices], feedback };
}

/**
 * The run control of a ticket with no run action: only its PR choices. The
 * main part runs the first choice, and the caret offers the others.
 */
export function MergeButton({ choices }: { choices: readonly SplitChoice[] }) {
	const [first, ...others] = choices;
	if (first === undefined) {
		return null;
	}
	return (
		<div className={clsx(panel.runAction)} data-pull-merge="true">
			{others.length === 0 ? (
				<Button
					label={first.label}
					tone="primary"
					disabled={first.disabled === true}
					onClick={first.onPick}
				/>
			) : (
				<SplitButton
					label={first.label}
					choicesLabel={pullMergeCopy.choices}
					tone="primary"
					disabled={first.disabled === true}
					onClick={first.onPick}
					choices={others}
				/>
			)}
		</div>
	);
}
