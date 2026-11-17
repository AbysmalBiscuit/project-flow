import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { Dropdown, type DropdownChoice } from "./dropdown.tsx";
import { usePaged } from "./factories-paging.tsx";
import {
	Card,
	MemoryList,
	type Picked,
	type SelectMode,
	Source,
} from "./memories-cards.tsx";
import type { MemoryRepo, MemoryRow } from "./memories-page.ts";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { type MemoryTab, memoryTabs } from "./memories-view.ts";
import { useMemoryMerge } from "./queries-memories.ts";
import { TextInput } from "./text-input.tsx";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const repoStyles = stylex.create({
	tabs: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.twoXs,
		marginBottom: space.md,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
	},
	tab: {
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderBottomWidth: measure.focus,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: "transparent",
		color: colours.inkMuted,
		font: "inherit",
		fontSize: type.menu,
		cursor: "pointer",
	},
	tabOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
	},
	toolbar: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.sm,
		marginBottom: space.md,
	},
	search: {
		flexGrow: 1,
	},
	softBar: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.sm,
		marginTop: space.md,
		padding: `${space.xs} ${space.sm}`,
		borderRadius: radius.md,
		backgroundColor: colours.surface,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	stickyBar: {
		position: "sticky",
		bottom: 0,
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		gap: space.sm,
		marginTop: space.md,
		padding: `${space.xs} ${space.sm}`,
		borderRadius: radius.md,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontSize: type.small,
	},
});

function uniqueRows(repo: MemoryRepo): MemoryRow[] {
	const seen = new Set<string>();
	return [...repo.conflicting, ...repo.recent].filter((row) => {
		if (seen.has(row.id)) {
			return false;
		}
		seen.add(row.id);
		return true;
	});
}

function inTab(row: MemoryRow, tab: MemoryTab): boolean {
	return tab === "all" || row.state === tab;
}

function matchesQuery(row: MemoryRow, query: string): boolean {
	const needle = query.trim().toLowerCase();
	return (
		needle === "" ||
		[row.text, ...row.paths, ...row.concepts].some((value) =>
			value.toLowerCase().includes(needle),
		)
	);
}

function MergeBar({
	repo,
	ids,
	onMerged,
}: {
	repo: string;
	ids: string[];
	onMerged: (id: string) => void;
}) {
	const merge = useMemoryMerge(repo);
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const closeDialog = () => {
		setOpen(false);
		setText("");
	};
	return (
		<>
			<div className={clsx(styles.actions)}>
				<button
					type="button"
					className={clsx(headerControlStyle.control, styles.voteButton)}
					disabled={merge.isPending}
					onClick={() => setOpen(true)}
				>
					{memoriesCopy.merge(ids.length)}
				</button>
			</div>
			{merge.isError ? (
				<p className={clsx(styles.warn)}>{merge.error.message}</p>
			) : null}
			<ConfirmDialog
				id={`memory-merge-dialog-${repo.replaceAll("/", "-")}`}
				open={open}
				title={memoriesCopy.mergeTitle}
				body={memoriesCopy.mergeBody(ids.length)}
				confirmLabel={memoriesCopy.merge(ids.length)}
				confirmDisabled={text.trim() === ""}
				onCancel={closeDialog}
				onConfirm={() => {
					merge.mutate(
						{ memories: ids, text },
						{
							onSuccess: (answer) => {
								if (answer.memory !== null) {
									onMerged(answer.memory.id);
								}
							},
						},
					);
					closeDialog();
				}}
			>
				<TextInput
					aria-label={memoriesCopy.mergeText}
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
			</ConfirmDialog>
		</>
	);
}

export function RepoMemories({
	repo,
	tab,
	onTab,
	picked,
	onPick,
	selected,
	onSelect,
	onClear,
	onMerged,
}: {
	repo: MemoryRepo;
	tab: MemoryTab;
	onTab: (tab: MemoryTab) => void;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
	selected: readonly string[];
	onSelect: (ids: readonly string[], mode: "toggle" | "add") => void;
	onClear: () => void;
	onMerged: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [kindChoice, setKindChoice] = useState("all");
	const anchor = useRef<string | null>(null);

	const rows = uniqueRows(repo);
	const kinds = [...new Set(rows.map((row) => row.kind))].sort();
	const kind =
		kindChoice === "all" || kinds.includes(kindChoice) ? kindChoice : "all";
	const kindChoices: DropdownChoice[] = [
		{ id: "all", label: memoriesCopy.allKinds },
		...kinds.map((item) => ({ id: item, label: item })),
	];
	const filtered = rows.filter(
		(row) =>
			inTab(row, tab) &&
			(kind === "all" || row.kind === kind) &&
			matchesQuery(row, query),
	);
	const paged = usePaged(
		memoriesCopy.tabs[tab],
		filtered,
		20,
		`${repo.repo}|${tab}|${query}|${kind}`,
	);

	const pick = (next: Picked) => {
		anchor.current = next.id;
		onPick(next);
	};

	const select = (id: string, mode: SelectMode) => {
		if (mode === "toggle") {
			anchor.current = id;
			onSelect([id], "toggle");
			return;
		}
		const ids = filtered.map((row) => row.id);
		const from = anchor.current === null ? -1 : ids.indexOf(anchor.current);
		const to = ids.indexOf(id);
		if (from === -1 || to === -1) {
			onSelect([id], "add");
		} else {
			onSelect(ids.slice(Math.min(from, to), Math.max(from, to) + 1), "add");
		}
		anchor.current = id;
	};

	const notice = repo.notServed
		? memoriesCopy.notServed(repo.factory)
		: repo.unreachable
			? memoriesCopy.unreachable(repo.factory)
			: rows.length === 0
				? memoriesCopy.noMemories
				: null;

	return (
		<Card
			title={repo.repo}
			head={<Source>{memoriesCopy.sources.review}</Source>}
		>
			{notice !== null ? (
				<p className={clsx(styles.empty)}>{notice}</p>
			) : (
				<>
					<div className={clsx(repoStyles.tabs)} role="tablist">
						{memoryTabs.map((item) => {
							const count = rows.filter((row) => inTab(row, item)).length;
							return (
								<button
									key={item}
									type="button"
									role="tab"
									aria-selected={item === tab}
									className={clsx(
										repoStyles.tab,
										item === tab && repoStyles.tabOn,
									)}
									onClick={() => onTab(item)}
								>
									{`${memoriesCopy.tabs[item]} ${count}`}
								</button>
							);
						})}
					</div>
					<div className={clsx(repoStyles.toolbar)}>
						<TextInput
							type="search"
							icon="search"
							aria-label={memoriesCopy.search}
							placeholder={memoriesCopy.search}
							value={query}
							width={repoStyles.search}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<Dropdown
							id="memories-kind"
							label={memoriesCopy.allKinds}
							value={kind}
							choices={kindChoices}
							onChange={setKindChoice}
							steadyWidth
						/>
					</div>
					{filtered.length === 0 ? (
						<p className={clsx(styles.empty)}>{memoriesCopy.noMatch}</p>
					) : (
						<>
							<MemoryList
								rows={paged.rows}
								repo={repo.repo}
								picked={picked}
								selected={selected}
								onPick={pick}
								onSelect={select}
								blank={paged.blank}
							/>
							{paged.pager}
						</>
					)}
					{selected.length === 1 ? (
						<div className={clsx(repoStyles.softBar)}>
							<span>{memoriesCopy.selected(1)}</span>
							<span>{memoriesCopy.addMore}</span>
							<Button
								label={memoriesCopy.clear}
								tone="quiet"
								onClick={onClear}
							/>
						</div>
					) : null}
					{selected.length >= 2 ? (
						<div className={clsx(repoStyles.stickyBar)}>
							<span>{memoriesCopy.selected(selected.length)}</span>
							<Button
								label={memoriesCopy.clear}
								tone="quiet"
								onClick={onClear}
							/>
							<MergeBar
								repo={repo.repo}
								ids={[...selected]}
								onMerged={onMerged}
							/>
						</div>
					) : null}
				</>
			)}
		</Card>
	);
}
