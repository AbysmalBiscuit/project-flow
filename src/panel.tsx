import { useEffect, useState } from "react";
import type { Thread, ThreadComment } from "./domain.ts";
import styles from "./panel.module.css";
import shell from "./shell.module.css";

type ReplyTarget = {
	parentId?: string;
	kind: ThreadComment["kind"];
};

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
		<ul className={styles.thread}>
			{comments.map((comment) => (
				<li
					key={comment.id}
					className={styles.comment}
					data-comment={comment.id}
				>
					<p className={styles.body}>{comment.body}</p>
					{nested || comment.kind === "review" ? (
						<button
							type="button"
							className={shell.button}
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

export function TicketPanel({
	tracker,
	project,
	ticketKey,
	onClose,
}: {
	tracker: "github" | "linear";
	project: string;
	ticketKey: string;
	onClose: () => void;
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
	return (
		<aside className={styles.panel} aria-label="Ticket thread">
			<button
				type="button"
				className={`${shell.button} ${styles.close}`}
				onClick={onClose}
			>
				Close
			</button>
			{missing ? <p>Thread not found</p> : null}
			{thread === null && !missing ? <p>Loading thread</p> : null}
			{thread === null ? null : (
				<>
					<h2>{thread.title}</h2>
					<p>
						<a className={styles.tracker} href={thread.url}>
							Open in tracker
						</a>
					</p>
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
					{tracker === "linear" ? (
						<button
							type="button"
							className={shell.button}
							onClick={() => setReplyTo({ kind: "comment" })}
						>
							New comment
						</button>
					) : (
						<button
							type="button"
							className={shell.button}
							onClick={() => setReplyTo({ kind: "comment" })}
						>
							Reply
						</button>
					)}
					{replyTo === null ? null : (
						<form
							className={styles.reply}
							onSubmit={(event) => {
								event.preventDefault();
								void send(replyTo);
							}}
						>
							<textarea
								className={styles.text}
								aria-label="Reply"
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
							/>
							<button type="submit" className={shell.button} disabled={pending}>
								Send
							</button>
							{error === null ? null : <p className={styles.error}>{error}</p>}
						</form>
					)}
				</>
			)}
		</aside>
	);
}
