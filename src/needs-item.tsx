import type { NeedsYouItem } from "./domain.ts";
import { clsx } from "./ui.ts";
import { needs } from "./ui-styles.ts";

export function NeedsItem({
	item,
	project = false,
	onOpen,
}: {
	item: NeedsYouItem;
	project?: boolean;
	onOpen?: (key: string) => void;
}) {
	return (
		<li
			className={clsx(needs.item, item.answered && needs.answered)}
			data-needs={item.key}
		>
			{project ? (
				<a
					className={clsx(needs.project)}
					href={`/projects/${encodeURIComponent(item.project)}`}
				>
					{item.project}
				</a>
			) : null}
			{onOpen === undefined ? (
				<span className={clsx(needs.headline)}>{item.headline}</span>
			) : (
				<button
					type="button"
					className={clsx(needs.open, needs.openHover)}
					onClick={() => onOpen(item.key)}
				>
					{item.headline}
				</button>
			)}
			{item.tags.length === 0 ? null : (
				<span className={clsx(needs.tag)}>{item.tags.join(" ")}</span>
			)}
		</li>
	);
}
