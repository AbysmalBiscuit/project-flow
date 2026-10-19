import type { NeedsYouItem } from "./domain.ts";

export function NeedsItem({
	item,
	project = false,
}: {
	item: NeedsYouItem;
	project?: boolean;
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
			<span className="headline">{item.headline}</span>
			{item.tags.length === 0 ? null : (
				<span className="tag">{item.tags.join(" ")}</span>
			)}
		</li>
	);
}
