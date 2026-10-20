import { useEffect, useState } from "react";
import type {
	OutsideBlocker,
	Thread,
	ThreadComment,
	TicketState,
} from "./domain.ts";
import { stateLabel } from "./terms.ts";
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
							className={clsx(
								shell.button,
								shell.buttonHover,
								shell.buttonFocus,
							)}
							onClick={() => onReply(comment)}
						>
							Reply
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
	relations: OutsideBlocker[];
	onOpen?: (blocker: OutsideBlocker) => void;
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
	blockers?: OutsideBlocker[];
	blocks?: OutsideBlocker[];
	onOpenBlocker?: (blocker: OutsideBlocker) => void;
	onClose: () => void;
	why?: string;
}) {
	const [thread, setThread] = useState<Thread | null>(null);
	const [missing, setMissing] = useState(false);
	const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
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
					setMissing(true);
					return;
				}
				setMissing(false);
				setThread((await response.json()) as Thread);
			})
			.catch(() => {
				if (!stopped) {
					setMissing(true);
				}
			});
		return () => {
			stopped = true;
		};
	}, [threadPath]);
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
	return (
		<aside
			className={clsx(panel.panel)}
			aria-label="Ticket thread"
			data-panel={ticketKey}
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
			{thread === null && !missing ? (
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
			{why === undefined ? null : (
				<section className={clsx(needs.why)} aria-label="Why this needs you">
					<h3 className={clsx(needs.whyLabel)}>Why this needs you</h3>
					<p className={clsx(needs.whyBody)}>{why}</p>
				</section>
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
		</aside>
	);
}
