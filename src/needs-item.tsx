import type { NeedsYouItem } from "./domain.ts";
import styles from "./needs.module.css";

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
			className={
				item.answered ? `${styles.item} ${styles.answered}` : styles.item
			}
			data-needs={item.key}
		>
			{project ? (
				<a
					className={styles.project}
					href={`/projects/${encodeURIComponent(item.project)}`}
				>
					{item.project}
				</a>
			) : null}
			{onOpen === undefined ? (
				<span className={styles.headline}>{item.headline}</span>
			) : (
				<button
					type="button"
					className={`${styles.open} ${styles.headline}`}
					onClick={() => onOpen(item.key)}
				>
					{item.headline}
				</button>
			)}
			{item.tags.length === 0 ? null : (
				<span className={styles.tag}>{item.tags.join(" ")}</span>
			)}
		</li>
	);
}
