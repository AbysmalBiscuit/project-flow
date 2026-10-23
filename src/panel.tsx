import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { board, laneMark } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type {
	Lane,
	NeedsYouItem,
	ThreadComment,
	TicketRelation,
	TicketState,
} from "./domain.ts";
import { menuOwnsEscape } from "./focus.ts";
import { CommentTree, RelationList, WhySection } from "./panel-sections.tsx";
import { pageQuery, usePostReply } from "./queries.ts";
import {
	closePanelLabel,
	collapsePanelLabel,
	expandPanelLabel,
	openPullLabel,
	projectPageLabel,
	pullButtonLabel,
	stateLabel,
	threadFailedLabel,
	threadMissingLabel,
	threadRetryLabel,
	whyLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { panel, shell } from "./ui-styles.ts";

type ReplyTarget = {
	parentId?: string;
	kind: ThreadComment["kind"];
};

export function TicketPanel({
	tracker,
	project,
	ticketKey,
	title,
	url,
	projectHref,
	state,
	lane,
	laneStyle,
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
	/** The project page of a ticket in another tracked project. */
	projectHref?: string | undefined;
	state?: TicketState;
	lane?: string | undefined;
	/** The lane in the report of the ticket's own project. */
	laneStyle?: Pick<Lane, "colour" | "statusType"> | undefined;
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
	const reportQuery = useQuery(pageQuery.project(project, "all"));
	const pullUrl = reportQuery.data?.tickets.find(
		(item) => item.key === ticketKey,
	)?.pullUrl;
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
	const href = thread?.url ?? url;
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
					{projectHref === undefined ? null : (
						<Button href={projectHref} label={projectPageLabel} />
					)}
					{href === undefined ? null : (
						<Button
							href={href}
							icon="external-link"
							label={trackerName}
							name={`Open on ${trackerName}`}
						/>
					)}
					{pullUrl === undefined ? null : (
						<Button
							href={pullUrl}
							newTab
							icon="external-link"
							label={pullButtonLabel}
							name={openPullLabel}
						/>
					)}
					{dock ? null : (
						<Button
							icon={expanded ? "shrink" : "expand"}
							name={expanded ? collapsePanelLabel : expandPanelLabel}
							onClick={() => setExpanded((open) => !open)}
						/>
					)}
					<Button icon="x" name={closePanelLabel} onClick={onClose} />
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
							laneStyle === undefined
								? board.markBacklog
								: laneMark(laneStyle.colour, laneStyle.statusType),
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
