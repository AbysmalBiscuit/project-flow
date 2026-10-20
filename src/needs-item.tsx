import type { NeedsYouItem } from "./domain.ts";
import { reasonLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { needs, shell } from "./ui-styles.ts";

const reasonMark: Record<NeedsYouItem["reason"], string> = {
	ask: "?",
	awaitingMerge: "⇄",
	label: "#",
	runFailed: "!",
};

export function NeedsItem({
	item,
	project,
	onOpen,
}: {
	item: NeedsYouItem;
	project?: boolean;
	onOpen?: (key: string) => void;
}) {
	const body = (
		<>
			<span className={clsx(needs.icon)} aria-hidden="true">
				{reasonMark[item.reason]}
			</span>
			<span className={clsx(needs.tag)}>{reasonLabel[item.reason]}</span>
			<span className={clsx(needs.key)}>{item.key}</span>
			<span className={clsx(needs.headline)}>{item.headline}</span>
			{item.tags.map((tag) => (
				<span key={tag} className={clsx(needs.tag)}>
					{tag}
				</span>
			))}
			{item.answered ? <span className={clsx(needs.tag)}>Answered</span> : null}
		</>
	);
	const projectLink =
		project !== true ? null : (
			<a
				className={clsx(needs.project, shell.button, shell.linkFocus)}
				href={`/projects/${encodeURIComponent(item.project)}`}
				data-needs-project={item.key}
			>
				{item.project}
			</a>
		);
	return (
		<li
			className={clsx(needs.item, item.answered && needs.answered)}
			data-needs={item.key}
		>
			{onOpen === undefined ? (
				<div className={clsx(needs.row)}>{body}</div>
			) : (
				<button
					type="button"
					className={clsx(needs.row)}
					onClick={() => onOpen(item.key)}
				>
					{body}
				</button>
			)}
			{projectLink}
		</li>
	);
}
