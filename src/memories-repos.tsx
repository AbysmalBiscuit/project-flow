import { useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.tsx";
import {
	Card,
	MemorySection,
	type MemorySelection,
	type Picked,
	Source,
} from "./memories-cards.tsx";
import type { MemoryRepo } from "./memories-page.ts";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { useMemoryMerge } from "./queries-memories.ts";
import { TextInput } from "./text-input.tsx";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

function RepoBody({
	repo,
	picked,
	onPick,
	selected,
	onToggle,
	onMerged,
}: {
	repo: MemoryRepo;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
	selected: string[];
	onToggle: (id: string) => void;
	onMerged: (id: string) => void;
}) {
	if (repo.notServed) {
		return (
			<p className={clsx(styles.empty)}>
				{memoriesCopy.notServed(repo.factory)}
			</p>
		);
	}
	if (repo.unreachable) {
		return (
			<p className={clsx(styles.empty)}>
				{memoriesCopy.unreachable(repo.factory)}
			</p>
		);
	}
	if (repo.conflicting.length === 0 && repo.recent.length === 0) {
		return <p className={clsx(styles.empty)}>{memoriesCopy.noMemories}</p>;
	}
	return (
		<>
			{repo.conflicting.length === 0 ? null : (
				<MemorySection
					title={memoriesCopy.conflicting}
					rows={repo.conflicting}
					repo={repo.repo}
					picked={picked}
					onPick={onPick}
					selected={selected}
					onToggle={onToggle}
				/>
			)}
			{repo.recent.length === 0 ? null : (
				<MemorySection
					title={memoriesCopy.recent}
					rows={repo.recent}
					repo={repo.repo}
					picked={picked}
					onPick={onPick}
					selected={selected}
					onToggle={onToggle}
				/>
			)}
			{selected.length >= 2 ? (
				<MergeBar repo={repo.repo} ids={selected} onMerged={onMerged} />
			) : null}
		</>
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

export function Repos({
	repos,
	picked,
	onPick,
	selected,
	onToggle,
	onMerged,
}: {
	repos: MemoryRepo[];
	picked: Picked | null;
	onPick: (picked: Picked) => void;
	selected: MemorySelection;
	onToggle: (repo: string, id: string) => void;
	onMerged: (repo: string, id: string) => void;
}) {
	if (repos.length === 0) {
		return <p className={clsx(styles.empty)}>{memoriesCopy.noRepos}</p>;
	}
	return (
		<div className={clsx(styles.repos)}>
			{repos.map((repo) => (
				<Card
					key={repo.repo}
					title={repo.repo}
					head={<Source>{memoriesCopy.sources.review}</Source>}
				>
					<RepoBody
						repo={repo}
						picked={picked}
						onPick={onPick}
						selected={selected.repo === repo.repo ? selected.ids : []}
						onToggle={(id) => onToggle(repo.repo, id)}
						onMerged={(id) => onMerged(repo.repo, id)}
					/>
				</Card>
			))}
		</div>
	);
}
