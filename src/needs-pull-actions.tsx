import { Button } from "./button.tsx";
import type { AwaitingPull, NeedsYouItem } from "./domain.ts";
import { usePullMerge } from "./pull-merge.tsx";
import { mergeGateReason, pullMergeCopy } from "./pull-terms.ts";
import type { SplitChoice } from "./split-button.tsx";
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

/** One button for each PR choice, or a held Merge when the forge offers none. */
function ChoiceButtons({
	choices,
	reason,
}: {
	choices: readonly SplitChoice[];
	reason: NeedsYouItem["reason"];
}) {
	if (choices.length === 0) {
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
			label={choice.label}
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
	const { choices, feedback } = usePullMerge(
		pulls,
		undefined,
		`needs-${item.key.replace(/[^\w-]/g, "-")}`,
	);
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
