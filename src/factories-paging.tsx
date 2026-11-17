import { useState } from "react";

import { Dropdown } from "./dropdown.tsx";
import { factoriesCopy } from "./factories-terms.ts";
import { type PagedList, type PageSize, pageSizes } from "./factories-view.ts";
import { pageOf, Pager } from "./pager.tsx";

const pageSizeChoices = pageSizes.map((rows) => ({
	id: String(rows),
	label: factoriesCopy.pageSize(rows),
}));

/** Picks the rows on one page of a Factories tab list. */
export function PageSizePicker({
	list,
	title,
	size,
	onChange,
}: {
	list: PagedList;
	title: string;
	size: PageSize;
	onChange: (size: PageSize) => void;
}) {
	return (
		<Dropdown
			id={`factories-${list}-rows`}
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

/** One page of `rows`, and the pager that moves between the pages. */
export function usePaged<Row>(
	title: string,
	rows: readonly Row[],
	size: number,
) {
	const [page, setPage] = useState(0);
	const paged = pageOf(rows, page, size);
	return {
		rows: paged.rows,
		/** Blank rows that keep the last page of a list as tall as the others. */
		blank: paged.pages > 1 ? size - paged.rows.length : 0,
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
