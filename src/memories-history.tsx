import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.tsx";
import { Card, Pill, Source } from "./memories-cards.tsx";
import type {
	MemoryCorrection,
	MemoryCorrectionRequest,
	MemoryRow,
} from "./memories-page.ts";
import { styles } from "./memories-styles.ts";
import { memoriesCopy } from "./memories-terms.ts";
import { runTime } from "./panel-sections.tsx";
import { useMemoryCorrection, useMemoryVote } from "./queries-memories.ts";
import { pageQuery } from "./queries-page.ts";
import { TextInput } from "./text-input.tsx";
import { ticketLabel } from "./ticket-key.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const corrections: readonly MemoryCorrection[] = [
	"supersede",
	"undo",
	"suppress",
	"restore",
];

/** The corrections that the daemon takes for the memory in its state. */
function offeredCorrections(memory: MemoryRow): MemoryCorrection[] {
	const inSearch =
		memory.state !== "superseded" && memory.state !== "suppressed";
	const offered: Record<MemoryCorrection, boolean> = {
		supersede: inSearch,
		undo: inSearch && memory.supersedes !== null,
		suppress: inSearch,
		restore: memory.state === "suppressed",
	};
	return corrections.filter((candidate) => offered[candidate]);
}

export function MemoryHistoryCard({
	repo,
	memoryId,
	onPick,
}: {
	repo: string;
	memoryId: string;
	onPick: (memoryId: string) => void;
}) {
	const query = useQuery(pageQuery.memory(repo, memoryId));
	const vote = useMemoryVote(repo, memoryId);
	const correction = useMemoryCorrection(repo, memoryId);
	const [dialog, setDialog] = useState<MemoryCorrection | null>(null);
	const [text, setText] = useState("");
	const [evidence, setEvidence] = useState("");
	const memory = query.data?.memory;
	const dialogCopy = {
		supersede: {
			title: memoriesCopy.supersedeTitle,
			body: memoriesCopy.supersedeBody,
			confirm: memoriesCopy.supersede,
		},
		undo: {
			title: memoriesCopy.undoTitle,
			body: memoriesCopy.undoBody(memory?.supersedes ?? ""),
			confirm: memoriesCopy.undo,
		},
		suppress: {
			title: memoriesCopy.suppressTitle,
			body: memoriesCopy.suppressBody,
			confirm: memoriesCopy.suppress,
		},
		restore: {
			title: memoriesCopy.restoreTitle,
			body: memoriesCopy.restoreBody,
			confirm: memoriesCopy.restore,
		},
	} satisfies Record<
		MemoryCorrection,
		{ title: string; body: string; confirm: string }
	>;
	const shown = dialog === null ? null : dialogCopy[dialog];
	const closeDialog = () => {
		setDialog(null);
		setText("");
		setEvidence("");
	};
	const answer = query.data;
	if (answer === undefined) {
		return null;
	}
	return (
		<Card
			title={memoriesCopy.history}
			head={<Source>{memoriesCopy.sources.history}</Source>}
		>
			{answer.notServed || answer.memory === null ? (
				<p className={clsx(styles.empty)}>{memoriesCopy.noHistory}</p>
			) : (
				<>
					<div className={clsx(styles.pills)}>
						<Pill>{answer.memory.kind}</Pill>
						<Pill>{answer.memory.state}</Pill>
					</div>
					<p className={clsx(styles.text)}>{answer.memory.text}</p>
					{answer.memory.supersedes === null ? null : (
						<span className={clsx(styles.votes)}>
							{memoriesCopy.supersedes(answer.memory.supersedes)}
						</span>
					)}
					{answer.memory.basis === null ? null : (
						<span className={clsx(styles.votes)}>
							{memoriesCopy.basis(answer.memory.basis)}
						</span>
					)}
					{answer.memory.duplicates.length > 0 ? (
						<span className={clsx(styles.votes)}>
							{memoriesCopy.duplicates(answer.memory.duplicates)}
						</span>
					) : null}
					<span className={clsx(styles.votes)}>
						{memoriesCopy.votes(
							answer.memory.votesFor,
							answer.memory.votesAgainst,
						)}
					</span>
					<div className={clsx(styles.actions)}>
						<button
							type="button"
							disabled={vote.isPending}
							className={clsx(headerControlStyle.control, styles.voteButton)}
							onClick={() => vote.mutate("for")}
						>
							{memoriesCopy.voteFor}
						</button>
						<button
							type="button"
							disabled={vote.isPending}
							className={clsx(headerControlStyle.control, styles.voteButton)}
							onClick={() => vote.mutate("against")}
						>
							{memoriesCopy.voteAgainst}
						</button>
						{offeredCorrections(answer.memory).map((offered) => (
							<button
								key={offered}
								type="button"
								disabled={correction.isPending}
								className={clsx(headerControlStyle.control, styles.voteButton)}
								onClick={() => setDialog(offered)}
							>
								{dialogCopy[offered].confirm}
							</button>
						))}
					</div>
					{vote.isError ? (
						<p className={clsx(styles.warn)}>{vote.error.message}</p>
					) : null}
					{correction.isError ? (
						<p className={clsx(styles.warn)}>{correction.error.message}</p>
					) : null}
					<div className={clsx(styles.section)}>
						<div className={clsx(styles.kicker, styles.sectionKicker)}>
							{memoriesCopy.changes}
						</div>
						{answer.changes.length === 0 ? (
							<p className={clsx(styles.empty)}>{memoriesCopy.noChanges}</p>
						) : (
							<ul className={clsx(styles.list)}>
								{answer.changes.map((change) => (
									<li
										key={`${change.at}-${change.previous}-${change.state}`}
										className={clsx(styles.item)}
									>
										<span className={clsx(styles.itemBody)}>
											{`${change.previous} -> ${change.state}`}
										</span>
										<span className={clsx(styles.where)}>
											{runTime(change.at)}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
					<div className={clsx(styles.section)}>
						<div className={clsx(styles.kicker, styles.sectionKicker)}>
							{memoriesCopy.evidence}
						</div>
						{answer.evidence.length === 0 ? (
							<p className={clsx(styles.empty)}>{memoriesCopy.noEvidence}</p>
						) : (
							<ul className={clsx(styles.list)}>
								{answer.evidence.map((record) => (
									<li
										key={`${record.at}-${record.kind}-${record.event}`}
										className={clsx(styles.item)}
									>
										<span className={clsx(styles.itemBody)}>
											{record.kind} {record.event}
										</span>
										<span className={clsx(styles.where)}>
											{record.ticket === null
												? null
												: `${ticketLabel(record.ticket)} `}
											{runTime(record.at)}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
					<ConfirmDialog
						id="memory-correction-dialog"
						open={dialog !== null}
						title={shown?.title ?? ""}
						body={shown?.body ?? ""}
						confirmLabel={shown?.confirm ?? ""}
						confirmDisabled={
							dialog === "supersede" &&
							(text.trim() === "" || evidence.trim() === "")
						}
						onCancel={closeDialog}
						onConfirm={() => {
							if (dialog === null) {
								return;
							}
							const request: MemoryCorrectionRequest =
								dialog === "supersede"
									? { correction: "supersede", text, evidence }
									: { correction: dialog };
							correction.mutate(request, {
								onSuccess: (result) => {
									if (result.memory !== null && result.memory.id !== memoryId) {
										onPick(result.memory.id);
									}
								},
							});
							closeDialog();
						}}
					>
						{dialog === "supersede" ? (
							<>
								<TextInput
									aria-label={memoriesCopy.newText}
									value={text}
									onChange={(event) => setText(event.target.value)}
								/>
								<TextInput
									aria-label={memoriesCopy.evidenceField}
									value={evidence}
									onChange={(event) => setEvidence(event.target.value)}
								/>
							</>
						) : null}
					</ConfirmDialog>
				</>
			)}
		</Card>
	);
}
