import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { Dropdown } from "./dropdown.tsx";
import { listDetail } from "./list-detail-styles.ts";
import type { MemoryRepo } from "./memories-page.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { Segment } from "./segment.tsx";
import { TextInput } from "./text-input.tsx";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	card: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
		height: measure.stickyPane,
		boxSizing: "border-box",
	},
	head: {
		display: "flex",
		alignItems: "baseline",
		justifyContent: "space-between",
		gap: space.sm,
		padding: `0 ${space.xs}`,
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	soft: {
		color: colours.inkSoft,
		fontSize: type.small,
	},
	controls: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.sm,
	},
	list: {
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
		margin: `0 calc(-1 * ${space.xs})`,
		padding: `0 ${space.xs}`,
		scrollbarColor: `${colours.scrollbar} ${colours.scrollbarTrack}`,
		scrollbarWidth: "thin",
		"::-webkit-scrollbar": {
			width: space.sm,
			height: space.sm,
		},
		"::-webkit-scrollbar-thumb": {
			backgroundColor: colours.scrollbar,
			borderRadius: radius.pill,
		},
		"::-webkit-scrollbar-track": {
			backgroundColor: colours.scrollbarTrack,
		},
	},
	row: {
		display: "block",
		width: "100%",
		minWidth: 0,
		textAlign: "left",
		borderWidth: 0,
		borderStyle: "none",
		backgroundColor: {
			default: "transparent",
			":hover": colours.rowHover,
		},
		color: colours.ink,
		padding: `${space.sm} ${space.sm}`,
		borderRadius: radius.sm,
		marginBottom: space.twoXs,
		cursor: "pointer",
		font: "inherit",
	},
	name: {
		display: "block",
		fontSize: type.small,
		fontWeight: type.weight,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	meta: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.xs,
		marginTop: space.twoXs,
		color: colours.inkSoft,
		fontSize: type.tag,
	},
	warnPill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.warnWash,
		color: colours.warnInk,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	empty: {
		margin: 0,
		padding: space.sm,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	footer: {
		color: colours.inkSoft,
		fontSize: type.small,
		padding: `0 ${space.xs}`,
	},
});

type RepoSort = "attention" | "size" | "name";

/** The number of distinct memories a repo shows, counting a memory once when it is both conflicting and recent. */
export function memoryCount(repo: MemoryRepo): number {
	return new Set(
		[...repo.conflicting, ...repo.recent].map((memory) => memory.id),
	).size;
}

/** Orders repos by the chosen sort. `attention` puts the most conflicts first, then the most memories. */
export function sortRepos(
	repos: readonly MemoryRepo[],
	sort: RepoSort,
): MemoryRepo[] {
	const bySort: Record<RepoSort, (a: MemoryRepo, b: MemoryRepo) => number> = {
		attention: (a, b) =>
			b.conflicting.length - a.conflicting.length ||
			memoryCount(b) - memoryCount(a),
		size: (a, b) => memoryCount(b) - memoryCount(a),
		name: (a, b) => a.repo.localeCompare(b.repo),
	};
	return [...repos].sort(bySort[sort]);
}

function splitSlug(slug: string): { owner: string; name: string } {
	const slash = slug.indexOf("/");
	if (slash === -1) {
		return { owner: "", name: slug };
	}
	return { owner: slug.slice(0, slash), name: slug.slice(slash + 1) };
}

const sortChoices = [
	{ id: "attention", label: memoriesCopy.sorts.attention },
	{ id: "size", label: memoriesCopy.sorts.size },
	{ id: "name", label: memoriesCopy.sorts.name },
] as const;

/** Narrows the sort choice to a `RepoSort`, so the dropdown needs no cast. */
function isRepoSort(id: string): id is RepoSort {
	return sortChoices.some((choice) => choice.id === id);
}

/**
 * The repo picker of the Memories page. It filters by slug and by conflicts,
 * sorts the repos, and reports the picked slug through `onPick`.
 */
export function RepoList({
	repos,
	current,
	onPick,
}: {
	repos: MemoryRepo[];
	current: string | null;
	onPick: (repo: string) => void;
}) {
	const [filter, setFilter] = useState("");
	const [conflictsOnly, setConflictsOnly] = useState(false);
	const [sort, setSort] = useState<RepoSort>("attention");

	const needle = filter.trim().toLowerCase();
	const shown = sortRepos(
		repos.filter(
			(repo) =>
				repo.repo.toLowerCase().includes(needle) &&
				(!conflictsOnly || repo.conflicting.length > 0),
		),
		sort,
	);

	return (
		<section className={clsx(styles.card, listDetail.sticky)}>
			<div className={clsx(styles.head)}>
				<span className={clsx(styles.kicker)}>{memoriesCopy.repos}</span>
				<span className={clsx(styles.soft)}>{repos.length}</span>
			</div>
			<TextInput
				type="search"
				icon="search"
				aria-label={memoriesCopy.filterRepos}
				placeholder={memoriesCopy.filterRepos}
				value={filter}
				onChange={(event) => setFilter(event.target.value)}
			/>
			<div className={clsx(styles.controls)}>
				<span className={clsx(headerControlStyle.group)}>
					<Segment
						label={memoriesCopy.hasConflicts}
						on={conflictsOnly}
						onClick={() => setConflictsOnly(!conflictsOnly)}
					/>
				</span>
				<Dropdown
					id="memories-repo-sort"
					label={memoriesCopy.sortRepos}
					value={sort}
					choices={sortChoices}
					steadyWidth
					onChange={(id) => {
						if (isRepoSort(id)) {
							setSort(id);
						}
					}}
				/>
			</div>
			<div className={clsx(styles.list)}>
				{shown.length === 0 ? (
					<p className={clsx(styles.empty)}>{memoriesCopy.noRepoMatch}</p>
				) : (
					shown.map((repo) => {
						const { owner, name } = splitSlug(repo.repo);
						const conflicts = repo.conflicting.length;
						return (
							<button
								key={repo.repo}
								type="button"
								aria-pressed={repo.repo === current}
								className={clsx(
									styles.row,
									repo.repo === current && listDetail.rowPicked,
								)}
								onClick={() => onPick(repo.repo)}
							>
								<span className={clsx(styles.name)} title={repo.repo}>
									{name}
								</span>
								<span className={clsx(styles.meta)}>
									<span>{owner}</span>
									{conflicts > 0 && (
										<span className={clsx(styles.warnPill)}>
											{memoriesCopy.conflictCount(conflicts)}
										</span>
									)}
									<span>{memoriesCopy.memoryCount(memoryCount(repo))}</span>
								</span>
							</button>
						);
					})
				)}
			</div>
			<div className={clsx(styles.footer)}>
				{memoriesCopy.repoCount(shown.length, repos.length)}
			</div>
		</section>
	);
}
