import type { NeedsYouItem } from "./domain.ts";

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
			className={item.answered ? "needs-you answered" : "needs-you"}
			data-needs={item.key}
		>
			{project ? (
				<>
					<a href={`/projects/${encodeURIComponent(item.project)}`}>
						{item.project}
					</a>{" "}
				</>
			) : null}
			{onOpen === undefined ? (
				<span className="headline">{item.headline}</span>
			) : (
				<button
					type="button"
					className="ticket-open headline"
					onClick={() => onOpen(item.key)}
				>
					{item.headline}
				</button>
			)}
			{item.tags.length === 0 ? null : (
				<span className="tag">{item.tags.join(" ")}</span>
			)}
		</li>
	);
}
