import { useState } from "react";

import { Dropdown } from "./dropdown.tsx";
import { factoriesCopy } from "./factories-terms.ts";
import { type PageSize, pageSizes } from "./factories-view.ts";
import { pageOf, Pager } from "./pager.tsx";

const pageSizeChoices = pageSizes.map((rows) => ({
	id: String(rows),
	label: factoriesCopy.pageSize(rows),
}));

/** Picks the rows on one page of a paged list. */
export function PageSizePicker({
	id,
	title,
	size,
	onChange,
}: {
	id: string;
	title: string;
	size: PageSize;
	onChange: (size: PageSize) => void;
}) {
	return (
		<Dropdown
			id={`${id}-rows`}
			label={factoriesCopy.pageSizeLabel(title)}
			value={String(size)}
			choices={pageSizeChoices}
			steadyWidth
			onChange={(choice) => {
				const picked = pageSizes.find((rows) => String(rows) === choice);
				if (picked !== undefined) {
					onChange(picked);
				}
			}}
		/>
	);
}

/**
 * One page of `rows`, and the pager that moves between the pages. The page
 * returns to 0 when `resetKey` changes.
 */
export function usePaged<Row>(
	title: string,
	rows: readonly Row[],
	size: number,
	/** Changing this key sends the list back to its first page. */
	resetKey?: string,
) {
	const [stored, setStored] = useState<{
		page: number;
		key: string | undefined;
	}>({ page: 0, key: resetKey });
	const page = stored.key === resetKey ? stored.page : 0;
	const setPage = (next: number) => setStored({ page: next, key: resetKey });
	const paged = pageOf(rows, page, size);
	return {
		rows: paged.rows,
		/** Blank rows that keep the last page of a list as tall as the others. */
		blank: paged.pages > 1 ? size - paged.rows.length : 0,
		/** Moves to the page that holds the row at `index`. */
		show: (index: number) => setPage(Math.floor(index / size)),
		pager: (
			<Pager
				list={title}
				page={paged.page}
				pages={paged.pages}
				onPage={setPage}
			/>
		),
	};
}
