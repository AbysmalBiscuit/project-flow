import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageLoading } from "./loading.tsx";
import type { MemorySelection, Picked } from "./memories-cards.tsx";
import { MemoryHistoryCard } from "./memories-history.tsx";
import { Repos } from "./memories-repos.tsx";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { pageQuery } from "./queries-page.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

export function Page() {
	const [picked, setPicked] = useState<Picked | null>(null);
	const [selected, setSelected] = useState<MemorySelection>({
		repo: "",
		ids: [],
	});
	const query = useQuery(pageQuery.memories);
	const page = query.data;
	const toggle = (repo: string, id: string) => {
		if (selected.repo !== repo) {
			setSelected({ repo, ids: [id] });
			return;
		}
		setSelected({
			repo,
			ids: selected.ids.includes(id)
				? selected.ids.filter((known) => known !== id)
				: [...selected.ids, id],
		});
	};
	const merged = (repo: string, id: string) => {
		setSelected({ repo: "", ids: [] });
		setPicked({ repo, id });
	};
	return (
		<PageFrame title={navLabel.memories} subtitle={memoriesCopy.subtitle}>
			{page === undefined ? (
				<PageLoading />
			) : (
				<Repos
					repos={page.repos}
					picked={picked}
					onPick={setPicked}
					selected={selected}
					onToggle={toggle}
					onMerged={merged}
				/>
			)}
			{picked === null ? (
				<p className={clsx(styles.empty)}>{memoriesCopy.pick}</p>
			) : (
				<MemoryHistoryCard
					repo={picked.repo}
					memoryId={picked.id}
					onPick={(id) => setPicked({ repo: picked.repo, id })}
				/>
			)}
		</PageFrame>
	);
}
