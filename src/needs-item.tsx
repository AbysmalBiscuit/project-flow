import type { ReactNode } from "react";
import type { NeedsYouItem } from "./domain.ts";
import { actionLabel, answeredReason, reasonLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs } from "./ui-styles.ts";

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

function CheckIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(needs.check)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M6 12.5l4 4 8-9" />
		</svg>
	);
}

const reasonIcon = {
	ask: AskIcon,
	awaitingMerge: MergeIcon,
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
	const action = actionLabel(item);
	const disabled = item.reason === "awaitingMerge" || item.reason === "label";
	const lead = (
		<>
			<span className={clsx(needs.icon)} aria-hidden="true">
				<Icon />
			</span>
			<span className={clsx(needs.key)}>{item.key}</span>
			<span className={clsx(needs.headline)}>{item.headline}</span>
		</>
	);
	return (
		<li
			className={clsx(
				needs.item,
				selected && needs.selected,
				item.answered && needs.answered,
			)}
			data-needs={item.key}
		>
			{onOpen === undefined ? (
				<div className={clsx(needs.row)}>{lead}</div>
			) : (
				<button
					type="button"
					className={clsx(needs.row)}
					onClick={() => onOpen(item.key)}
				>
					{lead}
				</button>
			)}
			<span className={clsx(needs.aside)}>
				{item.tags.map((tag) => (
					<span key={tag} className={clsx(needs.tag)}>
						{tag}
					</span>
				))}
				{item.answered ? (
					<span className={clsx(needs.tag)}>Answered</span>
				) : null}
				<span className={clsx(needs.reason)}>
					{item.answered ? answeredReason : reasonLabel[item.reason]}
				</span>
				{project === true ? (
					<a
						className={clsx(needs.project)}
						href={`/projects/${encodeURIComponent(item.project)}`}
						data-needs-project={item.key}
					>
						{item.project}
					</a>
				) : null}
				<button
					type="button"
					className={clsx(
						needs.action,
						item.reason === "ask" && !item.answered && needs.actionOn,
						disabled && needs.actionOff,
					)}
					disabled={disabled}
					onClick={() => (onAction ?? onOpen)?.(item.key)}
				>
					{action}
				</button>
				<button
					type="button"
					className={clsx(needs.quiet, needs.actionOff)}
					aria-label={`Clear ${item.key}`}
					disabled
				>
					<CheckIcon />
				</button>
			</span>
		</li>
	);
}
