import { useEffect, useState } from "react";
import type {
	NeedsYouItem,
	Thread,
	ThreadComment,
	TicketRelation,
	TicketState,
} from "./domain.ts";
import {
	mergeFactLabel,
	openOnGitHubLabel,
	pullStatusLabel,
	stateLabel,
	threadMissingLabel,
	whyLabel,
} from "./terms.ts";
import { lightValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { board, needs, panel, shell } from "./ui-styles.ts";

const laneMarks: Record<string, typeof board.markBacklog> = {
	[lightValues.done.toLowerCase()]: board.markDone,
	[lightValues.dropped.toLowerCase()]: board.markDropped,
	[lightValues.blocked.toLowerCase()]: board.markBlocked,
	[lightValues.backlog.toLowerCase()]: board.markBacklog,
	[lightValues.inProgress.toLowerCase()]: board.markInProgress,
	[lightValues.inReview.toLowerCase()]: board.markInReview,
	[lightValues.awaitingMerge.toLowerCase()]: board.markAwaitingMerge,
};

function laneMark(colour: string) {
	return laneMarks[colour.trim().toLowerCase()] ?? board.markBacklog;
}

type ReplyTarget = {
	parentId?: string;
	kind: ThreadComment["kind"];
};

function commentTime(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CommentTree({
	comments,
	nested,
	onReply,
}: {
	comments: ThreadComment[];
	nested: boolean;
	onReply: (comment: ThreadComment) => void;
}) {
	return (
		<ul className={clsx(panel.thread)}>
			{comments.map((comment) => (
				<li
					key={comment.id}
					className={clsx(panel.comment)}
					data-comment={comment.id}
				>
					<p className={clsx(panel.who)}>
						<span>{comment.author}</span>
						<span>{commentTime(comment.createdAt)}</span>
					</p>
					<p className={clsx(panel.body)}>{comment.body}</p>
					{nested || comment.kind === "review" ? (
						<button
							type="button"
							className={clsx(panel.answer, shell.buttonFocus)}
							onClick={() => onReply(comment)}
						>
							Answer
						</button>
					) : null}
					{comment.children.length === 0 ? null : (
						<CommentTree
							comments={comment.children}
							nested={true}
							onReply={onReply}
						/>
					)}
				</li>
			))}
		</ul>
	);
}

function RelationList({
	label,
	relations,
	onOpen,
}: {
	label: string;
	relations: TicketRelation[];
	onOpen?: (blocker: TicketRelation) => void;
}) {
	if (relations.length === 0) {
		return null;
	}
	return (
		<section aria-label={label}>
			<h3 className={clsx(panel.label)}>{label}</h3>
			<ul className={clsx(panel.relations)}>
				{relations.map((blocker) => (
					<li key={`${blocker.project} ${blocker.key}`}>
						<button
							type="button"
							className={clsx(
								shell.button,
								shell.buttonHover,
								shell.buttonFocus,
							)}
							data-blocker={blocker.key}
							onClick={() => onOpen?.(blocker)}
						>
							{blocker.key}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

function WhySection({
	item,
	pending,
	picked,
	onPick,
}: {
	item: NeedsYouItem;
	pending: boolean;
	picked: boolean;
	onPick: (option: number) => void;
}) {
	const question = item.question;
	const options = item.options ?? [];
	const pull = item.pull;
	if (question === undefined && pull === undefined && options.length === 0) {
		return null;
	}
	return (
		<section className={clsx(panel.section)} aria-label={whyLabel}>
			<h3 className={clsx(panel.whyLabel)}>{whyLabel}</h3>
			{question === undefined ? null : (
				<p className={clsx(panel.question)}>{question}</p>
			)}
			{pull === undefined ? null : (
				<dl className={clsx(panel.facts)}>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.pr}</dt>
						<dd className={clsx(panel.factValue)}>
							<a
								className={clsx(panel.factLink)}
								href={pull.url}
								aria-label={`${openOnGitHubLabel}, PR #${pull.number}`}
							>
								{openOnGitHubLabel}
							</a>
							<span>
								#{pull.number} {pull.title}
							</span>
						</dd>
					</div>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.ci}</dt>
						<dd className={clsx(panel.factValue)}>
							{pullStatusLabel.ci[pull.ci]}
						</dd>
					</div>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.review}</dt>
						<dd className={clsx(panel.factValue)}>
							{pullStatusLabel.review[pull.review]}
						</dd>
					</div>
				</dl>
			)}
			{options.length === 0 ? null : (
				<ul className={clsx(panel.options)}>
					{options.map((option) => (
						<li key={option.number}>
							<button
								type="button"
								className={clsx(panel.option, shell.buttonFocus)}
								data-option={option.number}
								disabled={pending || picked || item.answered}
								onClick={() => onPick(option.number)}
							>
								<span className={clsx(panel.number)}>{option.number}</span>
								<span>{option.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export function TicketPanel({
	tracker,
	project,
	ticketKey,
	title,
	url,
	state,
	lane,
	laneColour,
	blockers = [],
	blocks = [],
	onOpenBlocker,
	item = null,
	onClose,
	why,
}: {
	tracker: "github" | "linear";
	project: string;
	ticketKey: string;
	title?: string;
	url?: string | undefined;
	state?: TicketState;
	lane?: string | undefined;
	laneColour?: string | undefined;
	blockers?: TicketRelation[];
	blocks?: TicketRelation[];
	onOpenBlocker?: (blocker: TicketRelation) => void;
	item?: NeedsYouItem | null;
	onClose: () => void;
	why?: string;
}) {
	const [thread, setThread] = useState<Thread | null>(null);
	const [missing, setMissing] = useState(false);
	const [failed, setFailed] = useState(false);
	const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [picked, setPicked] = useState(false);
	useEffect(() => {
		if (item?.answered === true) {
			setPicked(false);
		}
	}, [item?.answered]);
	const threadPath = `/api/threads/${tracker}/${encodeURIComponent(ticketKey)}?project=${encodeURIComponent(project)}`;
	useEffect(() => {
		let stopped = false;
		fetch(threadPath)
			.then(async (response) => {
				if (stopped) {
					return;
				}
				if (!response.ok) {
					setThread(null);
					const body = (await response.json().catch(() => null)) as {
						missing?: boolean;
					} | null;
					const gone = body?.missing === true;
					setMissing(gone);
					setFailed(!gone);
					return;
				}
				setMissing(false);
				setFailed(false);
				setThread((await response.json()) as Thread);
			})
			.catch(() => {
				if (!stopped) {
					setThread(null);
					setMissing(false);
					setFailed(true);
				}
			});
		return () => {
			stopped = true;
		};
	}, [threadPath]);
	async function pick(option: number): Promise<void> {
		if (pending || picked) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			const response = await fetch("/api/replies", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ tracker, project, key: ticketKey, option }),
			});
			if (!response.ok) {
				const failed = (await response.json()) as { error?: string };
				setError(failed.error ?? "Reply failed");
				return;
			}
			setPicked(true);
			const loaded = await fetch(threadPath);
			if (loaded.ok) {
				setMissing(false);
				setFailed(false);
				setThread((await loaded.json()) as Thread);
			}
		} catch {
			setError("Reply failed");
		} finally {
			setPending(false);
		}
	}
	async function send(target: ReplyTarget): Promise<void> {
		if (draft.trim() === "" || pending) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			const response = await fetch("/api/replies", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tracker,
					project,
					key: ticketKey,
					body: draft,
					...(target.parentId === undefined
						? {}
						: { parentId: target.parentId }),
					kind: target.kind,
				}),
			});
			if (!response.ok) {
				const failed = (await response.json()) as { error?: string };
				setError(failed.error ?? "Reply failed");
				return;
			}
			setDraft("");
			setReplyTo(null);
			const loaded = await fetch(threadPath);
			if (loaded.ok) {
				setMissing(false);
				setFailed(false);
				setThread((await loaded.json()) as Thread);
			}
		} catch {
			setError("Reply failed");
		} finally {
			setPending(false);
		}
	}
	const trackerName = tracker === "linear" ? "Linear" : "GitHub";
	const laneName =
		lane ?? (state === undefined ? undefined : stateLabel[state]);
	const stateName = state === undefined ? "unknown" : state;
	return (
		<aside
			className={clsx(panel.panel, why === undefined ? null : panel.needs)}
			aria-label="Ticket thread"
			data-panel={ticketKey}
			data-state={stateName}
		>
			<div className={clsx(panel.head)}>
				<span className={clsx(panel.key)}>{ticketKey}</span>
				<span className={clsx(panel.actions)}>
					{thread === null && url === undefined ? null : (
						<a
							className={clsx(panel.open, shell.linkFocus)}
							href={thread?.url ?? url}
						>
							Open on {trackerName}
						</a>
					)}
					<button
						type="button"
						className={clsx(panel.dismiss, shell.buttonFocus)}
						aria-label="Close"
						onClick={onClose}
					>
						×
					</button>
				</span>
			</div>
			{missing || failed ? (
				<p className={clsx(panel.note)}>{threadMissingLabel}</p>
			) : null}
			{thread === null && !missing && !failed ? (
				<p className={clsx(panel.label)}>Loading thread</p>
			) : null}
			{thread !== null || title !== undefined ? (
				<h2 className={clsx(panel.heading)}>{thread?.title ?? title}</h2>
			) : null}
			{laneName === undefined ? null : (
				<p className={clsx(panel.state)}>
					<span
						className={clsx(
							board.laneMark,
							laneMark(laneColour ?? lightValues.backlog),
						)}
					/>
					{laneName}
				</p>
			)}
			{item === null || item === undefined ? (
				why === undefined ? null : (
					<section className={clsx(needs.why)} aria-label={whyLabel}>
						<h3 className={clsx(needs.whyLabel)}>{whyLabel}</h3>
						<p className={clsx(needs.whyBody)}>{why}</p>
					</section>
				)
			) : (
				<WhySection
					item={item}
					pending={pending}
					picked={picked || item.answered}
					onPick={(option) => {
						void pick(option);
					}}
				/>
			)}
			<RelationList
				label="Blockers"
				relations={blockers}
				{...(onOpenBlocker === undefined ? {} : { onOpen: onOpenBlocker })}
			/>
			<RelationList
				label="Blocks"
				relations={blocks}
				{...(onOpenBlocker === undefined ? {} : { onOpen: onOpenBlocker })}
			/>
			{thread === null ? null : (
				<CommentTree
					comments={thread.comments}
					nested={tracker === "linear"}
					onReply={(comment) =>
						setReplyTo({
							parentId: comment.parentId ?? comment.id,
							kind: comment.kind,
						})
					}
				/>
			)}
			{missing || failed ? null : (
				<form
					className={clsx(panel.reply)}
					onSubmit={(event) => {
						event.preventDefault();
						void send(replyTo ?? { kind: "comment" });
					}}
				>
					<label className={clsx(panel.label)} htmlFor="ticket-reply">
						Reply
					</label>
					<textarea
						id="ticket-reply"
						className={clsx(panel.text)}
						aria-label="Reply"
						placeholder="Write a comment"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
					/>
					<button type="submit" className={clsx(panel.send)} disabled={pending}>
						Comment
					</button>
					{error === null ? null : <p className={clsx(panel.error)}>{error}</p>}
				</form>
			)}
		</aside>
	);
}
