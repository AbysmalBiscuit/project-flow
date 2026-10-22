import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { board } from "./board-styles.ts";
import { CommentMarkdown } from "./comment-markdown.tsx";
import type {
	NeedsYouItem,
	ThreadComment,
	TicketRelation,
	TicketState,
} from "./domain.ts";
import { menuOwnsEscape } from "./focus.ts";
import { pageQuery, usePostReply } from "./queries.ts";
import {
	collapsePanelLabel,
	expandPanelLabel,
	mergeFactLabel,
	openOnGitHubLabel,
	pullStatusLabel,
	stateLabel,
	threadFailedLabel,
	threadMissingLabel,
	threadRetryLabel,
	whyLabel,
} from "./terms.ts";
import { lightValues } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { panel, shell } from "./ui-styles.ts";

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
					<CommentMarkdown html={comment.html} />
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
		<section className={clsx(panel.section)} aria-label={label}>
			<h3 className={clsx(panel.sectionLabel)}>{label}</h3>
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
			<h3 className={clsx(panel.sectionLabel)}>{whyLabel}</h3>
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
	dock = false,
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
	dock?: boolean;
}) {
	const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const threadQuery = useQuery(pageQuery.thread(tracker, project, ticketKey));
	const reply = usePostReply(tracker, project, ticketKey);
	const pending = reply.isPending;
	const root = useRef<HTMLElement>(null);
	const slot = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(onClose);
	const expandedRef = useRef(expanded);
	onCloseRef.current = onClose;
	expandedRef.current = expanded;
	useEffect(() => {
		if (item?.answered === true) {
			setPicked(false);
		}
	}, [item?.answered]);
	const read = threadQuery.isError
		? { status: "failed" as const }
		: threadQuery.data;
	const thread = read?.status === "ready" ? read.thread : null;
	const missing = read?.status === "missing";
	const failed = read?.status === "failed";
	const loadingThread = threadQuery.isFetching;
	useLayoutEffect(() => {
		const active = document.activeElement;
		opener.current =
			active instanceof HTMLElement && root.current?.contains(active) !== true
				? active
				: null;
	}, []);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				event.ctrlKey ||
				event.metaKey
			) {
				return;
			}
			const reply = document.getElementById("ticket-reply");
			if (event.target === reply || document.activeElement === reply) {
				event.preventDefault();
				if (reply instanceof HTMLElement) {
					reply.blur();
				}
				return;
			}
			if (menuOwnsEscape()) {
				return;
			}
			event.preventDefault();
			if (expandedRef.current) {
				setExpanded(false);
				return;
			}
			const target = opener.current;
			onCloseRef.current();
			setTimeout(() => {
				if (target?.isConnected === true) {
					target.focus();
				}
			}, 0);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
	async function pick(option: number): Promise<void> {
		if (pending || picked) {
			return;
		}
		setError(null);
		try {
			await reply.mutateAsync({ tracker, project, key: ticketKey, option });
			setPicked(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Reply failed");
		}
	}
	async function send(target: ReplyTarget): Promise<void> {
		if (draft.trim() === "" || pending) {
			return;
		}
		setError(null);
		try {
			await reply.mutateAsync({
				tracker,
				project,
				key: ticketKey,
				body: draft,
				...(target.parentId === undefined ? {} : { parentId: target.parentId }),
				kind: target.kind,
			});
			setDraft("");
			setReplyTo(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Reply failed");
		}
	}
	const trackerName = tracker === "linear" ? "Linear" : "GitHub";
	const laneName =
		lane ?? (state === undefined ? undefined : stateLabel[state]);
	const stateName = state === undefined ? "unknown" : state;
	const [cover, setCover] = useState<HTMLElement | null>(null);
	const host = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		const stage = host.current?.parentElement;
		if (stage === null || stage === undefined || dock) {
			setCover(null);
			return;
		}
		const node = document.createElement("div");
		node.dataset.panelCover = "";
		node.hidden = true;
		stage.append(node);
		setCover(node);
		return () => {
			const aside = root.current;
			const place = host.current;
			if (
				aside !== null &&
				place !== null &&
				aside.parentElement !== place &&
				place.isConnected
			) {
				place.append(aside);
			}
			node.remove();
			setCover(null);
		};
	}, [dock]);
	useLayoutEffect(() => {
		if (cover === null) {
			return;
		}
		cover.hidden = !expanded;
		cover.className = expanded ? clsx(panel.cover) : "";
	}, [cover, expanded]);

	const aside = (
		<aside
			className={clsx(
				panel.panel,
				why === undefined ? null : panel.needs,
				expanded && panel.expanded,
			)}
			aria-label="Ticket thread"
			data-panel={ticketKey}
			data-state={stateName}
			data-expanded={expanded ? "true" : "false"}
			ref={root}
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
					{dock ? null : (
						<button
							type="button"
							className={clsx(panel.expand, shell.buttonFocus)}
							aria-label={expanded ? collapsePanelLabel : expandPanelLabel}
							onClick={() => setExpanded((open) => !open)}
						>
							{expanded ? "Collapse" : "Expand"}
						</button>
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
			{missing ? (
				<p className={clsx(panel.note)}>{threadMissingLabel}</p>
			) : null}
			{failed ? (
				<p className={clsx(panel.note)}>
					{threadFailedLabel}{" "}
					<button
						type="button"
						className={clsx(panel.retry, shell.buttonFocus)}
						data-retry="thread"
						disabled={loadingThread}
						onClick={() => {
							void threadQuery.refetch();
						}}
					>
						{threadRetryLabel}
					</button>
				</p>
			) : null}
			{loadingThread || (thread === null && !missing && !failed) ? (
				<p className={clsx(panel.note)}>Loading thread</p>
			) : null}
			{thread !== null || title !== undefined ? (
				<h2 className={clsx(panel.heading)}>{thread?.title ?? title}</h2>
			) : null}
			{laneName === undefined ? null : (
				<p className={clsx(panel.state)}>
					<span
						className={clsx(
							board.laneMark,
							board.laneMarkGap,
							laneMark(laneColour ?? lightValues.backlog),
						)}
					/>
					{laneName}
				</p>
			)}
			{item === null || item === undefined ? (
				why === undefined ? null : (
					<section className={clsx(panel.section)} aria-label={whyLabel}>
						<h3 className={clsx(panel.sectionLabel)}>{whyLabel}</h3>
						<p className={clsx(panel.question)}>{why}</p>
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
					<button
						type="submit"
						className={clsx(panel.send, shell.buttonFocus)}
						disabled={pending}
					>
						Comment
					</button>
					{error === null ? null : <p className={clsx(panel.error)}>{error}</p>}
				</form>
			)}
		</aside>
	);
	useLayoutEffect(() => {
		const aside = root.current;
		const place = host.current;
		if (aside === null || place === null) {
			return;
		}
		const target = expanded && cover !== null ? cover : place;
		if (aside.parentElement !== target) {
			target.append(aside);
		}
	});
	return (
		<div ref={host} className={clsx(panel.host)}>
			{expanded && cover !== null ? (
				<div className={clsx(panel.slot)} data-panel-slot="" ref={slot} />
			) : null}
			{aside}
		</div>
	);
}
