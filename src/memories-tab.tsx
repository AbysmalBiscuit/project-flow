import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { PageLoading } from "./loading.tsx";
import type { MemoryRepo, MemoryRow } from "./memories-page.ts";
import { pageQuery, useMemoryVote } from "./queries.ts";
import { PageFrame } from "./shell.tsx";
import { memoriesCopy, navLabel } from "./terms.ts";
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

const voterKey = "project-flow.memory-voter";

const styles = stylex.create({
	voter: {
		display: "flex",
		flexDirection: "column",
		gap: space.xs,
		marginBottom: space.lg,
	},
	voterInput: {
		boxSizing: "border-box",
		width: measure.field,
		maxWidth: "100%",
		padding: `${space.xs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.surface,
		color: colours.ink,
		fontFamily: font.sans,
		fontSize: type.menu,
	},
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
			default: null,
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
}: {
	title: string;
	rows: MemoryRow[];
	repo: string;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
}) {
	return (
		<div className={clsx(styles.section)}>
			<div className={clsx(styles.kicker, styles.sectionKicker)}>{title}</div>
			<ul className={clsx(styles.list)}>
				{rows.map((row) => (
					<li key={row.id}>
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
}: {
	repo: MemoryRepo;
	picked: Picked | null;
	onPick: (picked: Picked) => void;
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
				/>
			)}
			<MemorySection
				title={memoriesCopy.recent}
				rows={repo.recent}
				repo={repo.repo}
				picked={picked}
				onPick={onPick}
			/>
		</>
	);
}

function Repos({
	repos,
	picked,
	onPick,
}: {
	repos: MemoryRepo[];
	picked: Picked | null;
	onPick: (picked: Picked) => void;
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
					<RepoBody repo={repo} picked={picked} onPick={onPick} />
				</Card>
			))}
		</div>
	);
}

function MemoryHistoryCard({
	repo,
	memoryId,
	voter,
}: {
	repo: string;
	memoryId: string;
	voter: string;
}) {
	const query = useQuery(pageQuery.memory(repo, memoryId));
	const vote = useMemoryVote(repo, memoryId);
	const answer = query.data;
	if (answer === undefined) {
		return null;
	}
	const voteDisabled = voter.trim() === "" || vote.isPending;
	return (
		<Card
			title={memoriesCopy.history}
			head={<Source>{memoriesCopy.sources.history}</Source>}
		>
			{answer.notServed || answer.memory === null ? (
				<p className={clsx(styles.empty)}>{memoriesCopy.historyNotServed}</p>
			) : (
				<>
					<div className={clsx(styles.pills)}>
						<Pill>{answer.memory.kind}</Pill>
						<Pill>{answer.memory.state}</Pill>
					</div>
					<p className={clsx(styles.text)}>{answer.memory.text}</p>
					<span className={clsx(styles.votes)}>
						{memoriesCopy.votes(
							answer.memory.votesFor,
							answer.memory.votesAgainst,
						)}
					</span>
					<div className={clsx(styles.actions)}>
						<button
							type="button"
							disabled={voteDisabled}
							className={clsx(headerControlStyle.control, styles.voteButton)}
							onClick={() =>
								vote.mutate({ voter: voter.trim(), stance: "for" })
							}
						>
							{memoriesCopy.voteFor}
						</button>
						<button
							type="button"
							disabled={voteDisabled}
							className={clsx(headerControlStyle.control, styles.voteButton)}
							onClick={() =>
								vote.mutate({ voter: voter.trim(), stance: "against" })
							}
						>
							{memoriesCopy.voteAgainst}
						</button>
					</div>
					{vote.isError ? (
						<p className={clsx(styles.warn)}>{memoriesCopy.voteFailed}</p>
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
										<span className={clsx(styles.where)}>{change.at}</span>
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
											{record.at}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</Card>
	);
}

export function Page() {
	const [voter, setVoter] = useState(
		() => localStorage.getItem(voterKey) ?? "",
	);
	const [picked, setPicked] = useState<Picked | null>(null);
	const query = useQuery(pageQuery.memories);
	const page = query.data;
	const changeVoter = (value: string) => {
		setVoter(value);
		localStorage.setItem(voterKey, value);
	};
	return (
		<PageFrame title={navLabel.memories} subtitle={memoriesCopy.subtitle}>
			<label className={clsx(styles.voter)}>
				<span className={clsx(styles.kicker)}>{memoriesCopy.voter}</span>
				<input
					type="text"
					className={clsx(styles.voterInput)}
					value={voter}
					placeholder={memoriesCopy.voterPlaceholder}
					onChange={(event) => changeVoter(event.currentTarget.value)}
				/>
			</label>
			{page === undefined ? (
				<PageLoading />
			) : (
				<Repos repos={page.repos} picked={picked} onPick={setPicked} />
			)}
			{picked === null ? (
				<p className={clsx(styles.empty)}>{memoriesCopy.pick}</p>
			) : (
				<MemoryHistoryCard
					repo={picked.repo}
					memoryId={picked.id}
					voter={voter}
				/>
			)}
		</PageFrame>
	);
}
