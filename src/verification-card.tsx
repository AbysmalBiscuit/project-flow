import type { ReactNode } from "react";

import { clsx } from "./ui.ts";
import { styles } from "./verification-styles.ts";

export function Sources({ route, store }: { route?: string; store?: string }) {
	return (
		<span className={clsx(styles.sources)}>
			{route === undefined ? null : (
				<span className={clsx(styles.source)}>{route}</span>
			)}
			{store === undefined ? null : (
				<span className={clsx(styles.source, styles.sourceStore)}>{store}</span>
			)}
		</span>
	);
}

export function Card({
	title,
	head,
	children,
}: {
	title: ReactNode;
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={clsx(styles.card)}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{head}
			</div>
			{children}
		</section>
	);
}
