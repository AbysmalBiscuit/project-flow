import { createContext, useContext } from "react";
import { board } from "./board-styles.ts";
import { GraphCardChips } from "./graph-card-chips.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { MeasuredNode } from "./graph-node-size.tsx";
import { CardHandles, type CardProps } from "./graph-view.tsx";
import { stateTones } from "./state-tone.ts";
import { tableTree } from "./table-tree-styles.ts";
import {
	openParentLabel,
	stateLabel,
	subTicketsDoneLabel,
	subTicketsToggleLabel,
} from "./terms.ts";
import { outsideKey, shortKey } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

export type TicketCard = {
	key: string;
	/** The node id of the ticket. A parent ticket card copied into another group keeps it. */
	ticketId: string;
	ticket: FlowTicket;
	/** The parent chip label, when the ticket has a parent ticket. */
	parentLabel?: string;
	open: boolean;
	/** A flat grouping shows the parent ticket hierarchy as chips. */
	hierarchyChips: boolean;
	/** The card heads the frame of its sub-tickets, which is open or collapsed. */
	frame: "open" | "collapsed" | null;
};

export function shortTicket(
	key: string,
	project: string,
	outside: boolean,
): string {
	return outside ? outsideKey(project, key) : shortKey(key);
}

export const FrameToggleContext = createContext<
	(card: string, key: string, startsCollapsed: boolean) => void
>(() => {});

function FrameToggle({
	card,
	ticket,
	collapsed,
	startsCollapsed,
}: {
	card: string;
	ticket: string;
	collapsed: boolean;
	startsCollapsed: boolean;
}) {
	const toggle = useContext(FrameToggleContext);
	return (
		<button
			type="button"
			className={clsx(board.frameToggle, board.cardFocus)}
			data-frame-toggle={ticket}
			aria-expanded={!collapsed}
			aria-label={subTicketsToggleLabel(ticket, collapsed)}
			onClick={(event) => {
				event.stopPropagation();
				toggle(card, ticket, startsCollapsed);
			}}
			// Focus scrolls the React Flow box when the graph overflows it, which
			// moves the toggle away before the click lands.
			onMouseDownCapture={(event) => event.preventDefault()}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<svg
				viewBox="0 0 8 8"
				aria-hidden="true"
				className={clsx(
					tableTree.toggleMark,
					collapsed && tableTree.toggleShut,
				)}
			>
				<path d="M2.5 1 5.5 4 2.5 7" fill="none" stroke="currentColor" />
			</svg>
		</button>
	);
}

export function TicketNode({ id, data }: CardProps<TicketCard>) {
	const key = data.ticket.key;
	const known = data.ticket.state;
	return (
		<>
			<button
				type="button"
				className={clsx(
					board.ticketNode,
					board.cardFocus,
					known !== undefined && board.toned,
					known !== undefined && stateTones[known],
					data.ticket.outside && board.ticketOutside,
					data.ticket.outside &&
						known === undefined &&
						board.ticketOutsideUntoned,
					data.open && board.ticketNodeOpen,
				)}
				data-graph-node={key}
				id={`graph-card-${id}`}
				data-outside={data.ticket.outside ? "true" : "false"}
				data-state={known ?? "unknown"}
				aria-pressed={data.open}
			>
				<MeasuredNode id={id} kind="ticket" />
				<CardHandles />
				<span
					className={clsx(
						board.meta,
						data.frame !== null && board.metaBesideToggle,
					)}
				>
					<span className={clsx(board.key)}>
						{shortTicket(key, data.ticket.project, data.ticket.outside)}
					</span>
					{data.ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>{data.ticket.pull}</span>
					)}
					{data.frame !== null && data.ticket.outside ? (
						<span className={clsx(board.pull)}>
							{known === undefined ? openParentLabel : stateLabel[known]}
						</span>
					) : null}
					{data.frame !== null && data.ticket.subTickets !== undefined ? (
						<span className={clsx(board.pull)}>
							{subTicketsDoneLabel(
								data.ticket.subTicketsDone ?? 0,
								data.ticket.subTickets,
							)}
						</span>
					) : null}
				</span>
				<span className={clsx(board.title)}>{data.ticket.title}</span>
				<GraphCardChips data={data} />
			</button>
			{data.frame === null ? null : (
				<FrameToggle
					card={id}
					ticket={data.ticket.key}
					collapsed={data.frame === "collapsed"}
					startsCollapsed={data.ticket.startsCollapsed === true}
				/>
			)}
		</>
	);
}
