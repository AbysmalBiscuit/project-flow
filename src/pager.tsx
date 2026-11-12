import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Button } from "./button.tsx";
import { factoriesCopy } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { colours, measure, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	pager: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		justifyContent: "flex-end",
		marginTop: space.md,
		color: colours.inkMuted,
		fontSize: type.small,
	},
	input: {
		width: measure.pagerInput,
	},
});

/** The rows of one page, and the page count, of a list split into pages of `size` rows. */
export function pageOf<Row>(rows: readonly Row[], page: number, size: number) {
	const pages = Math.max(1, Math.ceil(rows.length / size));
	const shown = Math.min(page, pages - 1);
	return {
		rows: rows.slice(shown * size, (shown + 1) * size),
		page: shown,
		pages,
	};
}

/** `[<] [page] of N [>]` under a list. Shows nothing for a list of one page. */
export function Pager({
	list,
	page,
	pages,
	onPage,
}: {
	list: string;
	/** Counts from 0. */
	page: number;
	pages: number;
	onPage: (page: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	if (pages <= 1) {
		return null;
	}
	const commit = () => {
		const typed = Number.parseInt(draft ?? "", 10);
		if (Number.isFinite(typed)) {
			onPage(Math.min(pages, Math.max(1, typed)) - 1);
		}
		setDraft(null);
	};
	return (
		<nav
			className={clsx(styles.pager)}
			aria-label={factoriesCopy.pager.page(list)}
		>
			<Button
				icon="chevron-left"
				name={factoriesCopy.pager.previous}
				disabled={page === 0}
				onClick={() => onPage(page - 1)}
			/>
			<TextInput
				aria-label={factoriesCopy.pager.page(list)}
				inputMode="numeric"
				value={draft ?? String(page + 1)}
				width={styles.input}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						commit();
					}
				}}
			/>
			<span>{factoriesCopy.pager.of(pages)}</span>
			<Button
				icon="chevron-right"
				name={factoriesCopy.pager.next}
				disabled={page === pages - 1}
				onClick={() => onPage(page + 1)}
			/>
		</nav>
	);
}
