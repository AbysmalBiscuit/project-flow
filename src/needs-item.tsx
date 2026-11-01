import type { ReactNode } from "react";

import { Button } from "./button.tsx";
import { control, textControl } from "./control-styles.ts";
import type { AwaitingPull, NeedsYouItem } from "./domain.ts";
import { needs } from "./needs-you-styles.ts";
import { usePullMerge } from "./pull-merge.tsx";
import { mergeGateReason, pullMergeCopy } from "./pull-terms.ts";
import type { SplitChoice } from "./split-button.tsx";
import {
	actionLabel,
	answeredReason,
	heldActionLabel,
	openQuestionsLabel,
	reasonLabel,
} from "./terms.ts";
import { phoneLayout } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

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
function PullActions({
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

function heldAction(item: NeedsYouItem): string | null {
	if (item.reason === "label") {
		return heldActionLabel.removeLabel;
	}
	return null;
}

function Mark({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(needs.glyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{children}
		</svg>
	);
}

function AskIcon() {
	return (
		<Mark>
			<path d="M5 6.5h14v8H8l-3 3z" />
		</Mark>
	);
}

function MergeIcon() {
	return (
		<Mark>
			<circle cx="12" cy="12" r="7" />
			<path d="M9 12.2l2 2 4-4.4" />
		</Mark>
	);
}

function DecideIcon() {
	return (
		<Mark>
			<circle cx="12" cy="12" r="7" />
			<path d="M10 10a2 2 0 1 1 2.5 1.9c-.3.1-.5.4-.5.7v.9M12 16.5h.01" />
		</Mark>
	);
}

function LabelIcon() {
	return (
		<Mark>
			<path d="M4 8.5l8-4 8 4z" />
			<path d="M4 12.5l8 4 8-4" />
		</Mark>
	);
}

function FailIcon() {
	return (
		<Mark>
			<circle cx="12" cy="12" r="7" />
			<path d="M12 8v5M12 16.5h.01" />
		</Mark>
	);
}

const reasonIcon = {
	ask: AskIcon,
	awaitingMerge: MergeIcon,
	decide: DecideIcon,
	label: LabelIcon,
	runFailed: FailIcon,
} as const;

export function NeedsItem({
	item,
	project,
	selected = false,
	onOpen,
	onAction,
}: {
	item: NeedsYouItem;
	project?: boolean;
	selected?: boolean;
	onOpen?: (key: string) => void;
	onAction?: (key: string) => void;
}) {
	const Icon = reasonIcon[item.reason];
	const pulls = item.awaitingPulls ?? [];
	const held = heldAction(item);
	const action = held ?? actionLabel(item);
	const lead = (
		<>
			<span className={clsx(needs.icon)} aria-hidden="true">
				<Icon />
			</span>
			<span className={clsx(needs.key, phoneLayout.needsKey)}>{item.key}</span>
			<span className={clsx(needs.headline)}>{item.headline}</span>
		</>
	);
	return (
		<li
			className={clsx(
				needs.item,
				phoneLayout.needsItem,
				selected && needs.selected,
				item.answered && needs.answered,
			)}
			data-needs={item.key}
		>
			{onOpen === undefined ? (
				<div className={clsx(needs.row, phoneLayout.needsRow)}>{lead}</div>
			) : (
				<button
					type="button"
					className={clsx(
						needs.row,
						control.clear,
						control.focus,
						phoneLayout.needsRow,
					)}
					onClick={() => onOpen(item.key)}
				>
					{lead}
				</button>
			)}
			<span className={clsx(needs.aside, phoneLayout.needsAside)}>
				{item.tags.map((tag) => (
					<span key={tag} className={clsx(needs.tag)}>
						{tag}
					</span>
				))}
				{item.openQuestions === undefined ? null : (
					<span className={clsx(needs.tag)} data-open-questions={item.key}>
						{openQuestionsLabel(item.openQuestions)}
					</span>
				)}
				{item.answered ? (
					<span className={clsx(needs.tag)}>Answered</span>
				) : null}
				<span className={clsx(needs.reason)}>
					{item.answered ? answeredReason : reasonLabel[item.reason]}
				</span>
				{project === true ? (
					<a
						className={clsx(needs.project, ...textControl)}
						href={`/projects/${encodeURIComponent(item.project)}`}
						data-needs-project={item.key}
					>
						{item.project}
					</a>
				) : null}
				{pulls.length > 0 ? (
					<PullActions item={item} pulls={pulls} />
				) : (
					<Button
						label={action}
						{...(item.reason === "ask" && !item.answered
							? { tone: "primary" as const }
							: {})}
						data-held-action={held === null ? undefined : item.reason}
						disabled={held !== null}
						onClick={() => (onAction ?? onOpen)?.(item.key)}
					/>
				)}
				<Button icon="check" name={`Clear ${item.key}`} disabled />
			</span>
		</li>
	);
}
