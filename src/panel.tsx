import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { board } from "./board-styles.ts";
import { Button } from "./button.tsx";
import type { NeedsYouItem, ProjectReport, ThreadComment } from "./domain.ts";
import { menuOwnsEscape } from "./focus.ts";
import { CommentTree, RelationList, WhySection } from "./panel-sections.tsx";
import { pathProject, projectPath } from "./paths.ts";
import { pageQuery, usePostReply } from "./queries.ts";
import { openTicket } from "./selection.ts";
import { toneOf } from "./state-tone.ts";
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
} from "./terms.ts";
import { sameTicketKey, type TicketRef } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { panel, shell } from "./ui-styles.ts";

type ReplyTarget = {
	parentId?: string;
	kind: ThreadComment["kind"];
};

function trackerUrl(ticket: TicketRef): string | undefined {
	if (ticket.tracker === "github" && ticket.key.includes("#")) {
		return `https://github.com/${ticket.key.replace("#", "/issues/")}`;
	}
	if (ticket.tracker === "linear") {
		return `https://linear.app/issue/${ticket.key}`;
	}
	return undefined;
}

function needsYouItem(
	report: ProjectReport | null,
	key: string,
): NeedsYouItem | null {
	const section = report?.sections.find((item) => item.id === "needsYou");
	return (
		section?.needsYou?.find((item) => sameTicketKey(item.key, key)) ?? null
	);
}

/** The side panel of one ticket. It reads the ticket from the cached report of the ticket's project. */
export function TicketPanel({
	ticket,
	onClose,
	dock = false,
}: {
	ticket: TicketRef;
	onClose: () => void;
	dock?: boolean;
}) {
	const { tracker, project, key: ticketKey } = ticket;
	const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const threadQuery = useQuery(pageQuery.thread(tracker, project, ticketKey));
	const reportQuery = useQuery(pageQuery.project(project, "all"));
	const report = reportQuery.data ?? null;
	const view = report?.tickets.find(
		(item) => item.key !== null && sameTicketKey(item.key, ticketKey),
	);
	const item = needsYouItem(report, ticketKey);
	useEffect(() => {
		if (report !== null && report.tracker !== tracker) {
			openTicket({ ...ticket, tracker: report.tracker }, "replace");
		}
	}, [report, tracker, ticket]);
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
	const href = thread?.url ?? trackerUrl(ticket);
	const projectHref =
		report === null || pathProject(window.location.pathname) === project
			? undefined
			: projectPath(project, ticket);
	const state = view?.state;
	const laneName =
		view?.lane ?? (state === undefined ? undefined : stateLabel[state]);
	const laneState = report?.lanes.find(
		(lane) => lane.name === view?.lane,
	)?.statusType;
	const stateName = state ?? "unknown";
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
			className={clsx(panel.panel, expanded && panel.expanded)}
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
					{view?.pullUrl === undefined ? null : (
						<Button
							href={view.pullUrl}
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
			{thread !== null || view !== undefined ? (
				<h2 className={clsx(panel.heading)}>{thread?.title ?? view?.title}</h2>
			) : null}
			{laneName === undefined ? null : (
				<p className={clsx(panel.state)}>
					<span
						className={clsx(
							board.laneMark,
							board.laneMarkGap,
							toneOf(laneState),
						)}
					/>
					{laneName}
				</p>
			)}
			{item === null ? null : (
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
				relations={view?.blockedBy ?? []}
				onOpen={openTicket}
			/>
			<RelationList
				label="Blocks"
				relations={view?.blocks ?? []}
				onOpen={openTicket}
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
