import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listDetail } from "./list-detail-styles.ts";
import { PageLoading } from "./loading.tsx";
import type { MemorySelection, Picked } from "./memories-cards.tsx";
import { MemoryHistoryCard } from "./memories-history.tsx";
import type { MemoryRepo } from "./memories-page.ts";
import { RepoList, sortRepos } from "./memories-repo-list.tsx";
import { RepoMemories } from "./memories-repos.tsx";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import {
	type MemoriesView,
	memoriesViewDefaults,
	type MemoryTab,
} from "./memories-view.ts";
import { pageQueryClient } from "./queries-client.ts";
import { pageQuery } from "./queries-page.ts";
import { useSaveSettings } from "./queries-settings.ts";
import { configurationOf } from "./queries-shapes.ts";
import { PageFrame } from "./shell.tsx";
import { useShortcut } from "./shortcuts.ts";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

const noSelection: MemorySelection = { repo: "", ids: [] };

export function Page() {
	const settings = useQuery({ ...pageQuery.settings, select: configurationOf });
	const memories = useQuery(pageQuery.memories);
	if (settings.data === undefined || memories.data === undefined) {
		return (
			<PageFrame title={navLabel.memories} subtitle={memoriesCopy.subtitle}>
				<PageLoading />
			</PageFrame>
		);
	}
	return (
		<MemoriesBody
			repos={memories.data.repos}
			view={settings.data?.memoriesView ?? memoriesViewDefaults}
		/>
	);
}

function MemoriesBody({
	repos,
	view,
}: {
	repos: MemoryRepo[];
	view: MemoriesView;
}) {
	const save = useSaveSettings({ refetchProjects: false, optimistic: true });
	const [current, setCurrent] = useState<string | null>(
		() => sortRepos(repos, "attention")[0]?.repo ?? null,
	);
	const [picked, setPicked] = useState<Picked | null>(null);
	const [selected, setSelected] = useState<MemorySelection>(noSelection);
	const currentRepo = repos.find((repo) => repo.repo === current);

	const clear = () => setSelected(noSelection);
	useShortcut("clearMemorySelection", clear, selected.ids.length > 0);

	const pickRepo = (repo: string) => {
		setCurrent(repo);
		setPicked(null);
		setSelected(noSelection);
	};

	const onTab = (tab: MemoryTab) => {
		setSelected(noSelection);
		void save
			.mutateAsync((settings) => ({
				...settings,
				memoriesView: { tab },
			}))
			.catch(() => pageQueryClient.invalidateQueries(pageQuery.settings));
	};

	const onSelect = (ids: readonly string[], mode: "toggle" | "add") => {
		if (current === null) return;
		const base = selected.repo === current ? selected.ids : [];
		if (mode === "toggle") {
			const [id] = ids;
			if (id === undefined) return;
			setSelected({
				repo: current,
				ids: base.includes(id)
					? base.filter((known) => known !== id)
					: [...base, id],
			});
			return;
		}
		setSelected({
			repo: current,
			ids: [...base, ...ids.filter((id) => !base.includes(id))],
		});
	};

	const onMerged = (id: string) => {
		if (current === null) return;
		setSelected(noSelection);
		setPicked({ repo: current, id });
	};

	return (
		<PageFrame title={navLabel.memories} subtitle={memoriesCopy.subtitle}>
			<div className={clsx(styles.panes)}>
				<RepoList repos={repos} current={current} onPick={pickRepo} />
				{currentRepo === undefined ? (
					<p className={clsx(styles.empty)}>{memoriesCopy.noRepos}</p>
				) : (
					<RepoMemories
						repo={currentRepo}
						tab={view.tab}
						onTab={onTab}
						picked={picked}
						onPick={setPicked}
						selected={selected.ids}
						onSelect={onSelect}
						onClear={clear}
						onMerged={onMerged}
					/>
				)}
				<div className={clsx(listDetail.sticky)}>
					{picked === null ? (
						<p className={clsx(styles.empty)}>{memoriesCopy.pick}</p>
					) : (
						<MemoryHistoryCard
							repo={picked.repo}
							memoryId={picked.id}
							onPick={(id) => setPicked({ repo: picked.repo, id })}
						/>
					)}
				</div>
			</div>
		</PageFrame>
	);
}
