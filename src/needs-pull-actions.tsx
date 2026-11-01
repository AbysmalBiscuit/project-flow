import { useId } from "react";

import { Button } from "./button.tsx";
import type { AwaitingPull, NeedsYouItem } from "./domain.ts";
import { type PullChoice, usePullMerge } from "./pull-merge.tsx";
import { mergeGateReason, pullMergeCopy } from "./pull-terms.ts";
import { heldActionLabel } from "./terms.ts";

/** A link to a PR of a Decide row, where Lev answers its Important Questions. */
function PullLink({ pull }: { pull: AwaitingPull }) {
	return (
		<Button
			label={pullMergeCopy.open(pull.number)}
			icon="external-link"
			href={pull.url}
			newTab
		/>
	);
}

/**
 * One button for each PR choice, with the gate reason as its tooltip. An
 * Awaiting merge row whose forge offers no choice shows a held Merge. A Decide
 * row never shows Merge, because the merge gate blocks it.
 */
function ChoiceButtons({
	choices,
	reason,
}: {
	choices: readonly PullChoice[];
	reason: NeedsYouItem["reason"];
}) {
	if (choices.length === 0 && reason !== "decide") {
		return (
			<Button
				label={heldActionLabel.merge}
				tooltip={mergeGateReason.noCapability}
				data-held-action={reason}
				disabled
			/>
		);
	}
	return choices.map((choice) => (
		<Button
			key={choice.label}
			label={choice.short}
			{...(choice.reason === undefined ? {} : { tooltip: choice.reason })}
			disabled={choice.disabled === true}
			onClick={choice.onPick}
		/>
	));
}

/**
 * The PR actions of an Awaiting merge or Decide row, through the same confirm
 * steps as the side panel.
 */
export function PullActions({
	item,
	pulls,
}: {
	item: NeedsYouItem;
	pulls: readonly AwaitingPull[];
}) {
	const { choices, feedback } = usePullMerge(pulls, undefined, useId());
	return (
		<>
			{item.reason === "decide"
				? pulls.map((pull) => <PullLink key={pull.url} pull={pull} />)
				: null}
			<ChoiceButtons choices={choices} reason={item.reason} />
			{feedback}
		</>
	);
}
