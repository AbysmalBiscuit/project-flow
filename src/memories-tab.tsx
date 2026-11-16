import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { board } from "./board-styles.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { PageLoading } from "./loading.tsx";
import type {
	MemoryCorrection,
	MemoryCorrectionRequest,
	MemoryRepo,
	MemoryRow,
} from "./memories-page.ts";
import { runTime } from "./panel-sections.tsx";
import {
	pageQuery,
	useMemoryCorrection,
	useMemoryMerge,
	useMemoryVote,
} from "./queries.ts";
import { PageFrame } from "./shell.tsx";
import { memoriesCopy, navLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { ticketLabel } from "./ticket-key.ts";
import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	repos: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
	},
	card: {
		boxSizing: "border-box",
		minWidth: 0,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	head: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	heading: {
		margin: 0,
		color: colours.ink,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	source: {
		marginLeft: "auto",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	sectionKicker: {
		marginBottom: space.xs,
	},
	section: {
		marginTop: space.md,
	},
	pills: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginBottom: space.xs,
	},
	pill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	memory: {
		display: "block",
		boxSizing: "border-box",
		width: "100%",
		margin: 0,
		padding: `${space.sm} 0`,
		borderWidth: 0,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		backgroundColor: {
			default: "transparent",
			":hover": colours.surface,
		},
		color: colours.ink,
		fontFamily: "inherit",
		fontSize: type.menu,
		textAlign: "left",
		cursor: "pointer",
		outline: {
			default: "none",
			":focus-visible": `${measure.focus} solid ${colours.focus}`,
		},
	},
	memoryOn: {
		backgroundColor: {
			default: colours.rowOn,
			":hover": colours.rowOn,
		},
	},
	text: {
		display: "block",
		margin: 0,
		color: colours.ink,
		fontSize: type.menu,
		overflowWrap: "anywhere",
	},
	tags: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginTop: space.xs,
	},
	tag: {
		padding: `${space.twoXs} ${space.xs}`,
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		overflowWrap: "anywhere",
	},
	votes: {
		display: "block",
		marginTop: space.xs,
		color: colours.inkSoft,
		fontSize: type.small,
		fontVariantNumeric: "tabular-nums",
	},
	actions: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		margin: `${space.md} 0`,
	},
	voteButton: {
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
		opacity: {
			default: null,
			":disabled": 0.5,
		},
	},
	warn: {
		margin: `${space.sm} 0 0`,
		color: colours.danger,
		fontSize: type.small,
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	row: {
		display: "flex",
		gap: space.sm,
		alignItems: "flex-start",
	},
	check: {
		marginTop: space.sm,
	},
	item: {
		display: "flex",
		gap: space.sm,
		alignItems: "baseline",
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
	},
	itemBody: {
		minWidth: 0,
		overflowWrap: "anywhere",
	},
	where: {
		flexShrink: 0,
		maxWidth: "50%",
		marginLeft: "auto",
		paddingLeft: space.sm,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		overflowWrap: "anywhere",
		textAlign: "right",
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
});

type Picked = { repo: string; id: string };

type MemorySelection = { repo: string; ids: string[] };

function Source({ children }: { children: string }) {
	return <span className={clsx(styles.source)}>{children}</span>;
}

function Pill({ children }: { children: string }) {
	return <span className={clsx(styles.pill)}>{children}</span>;
}

function Card({
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

function MemoryButton({
	row,
	on,
	onPick,
}: {
	row: MemoryRow;
	on: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			className={clsx(styles.memory, on && styles.memoryOn)}
			onClick={onPick}
		>
			<span className={clsx(styles.pills)}>
				<Pill>{row.kind}</Pill>
				<Pill>{row.state}</Pill>
			</span>
			<span className={clsx(styles.text)}>{row.text}</span>
			<span className={clsx(styles.tags)}>
				{row.paths.map((path) => (
					<span key={path} className={clsx(styles.tag)}>
						{path}
					</span>
				))}
				{row.concepts.map((concept) => (
					<span key={concept} className={clsx(styles.tag)}>
						{concept}
					</span>
				))}
			</span>
			<span className={clsx(styles.votes)}>
				{memoriesCopy.votes(row.votesFor, row.votesAgainst)}
			</span>
		</button>
	);
}

function MemorySection({
	title,
	rows,
	repo,
	picked,
	onPick,
	selected,
	onToggle,
}: {
	title: string;
	rows: MemoryRow[];
	repo: string;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
	selected: string[];
	onToggle: (id: string) => void;
}) {
	return (
		<div className={clsx(styles.section)}>
			<div className={clsx(styles.kicker, styles.sectionKicker)}>{title}</div>
			<ul className={clsx(styles.list)}>
				{rows.map((row) => (
					<li key={row.id} className={clsx(styles.row)}>
						<input
							type="checkbox"
							className={clsx(board.check, styles.check)}
							aria-label={memoriesCopy.select}
							checked={selected.includes(row.id)}
							onChange={() => onToggle(row.id)}
						/>
						<MemoryButton
							row={row}
							on={picked?.repo === repo && picked.id === row.id}
							onPick={() => onPick({ repo, id: row.id })}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

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

function Repos({
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

function MemoryHistoryCard({
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
