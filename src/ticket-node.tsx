import * as stylex from "@stylexjs/stylex";
import { createContext, useContext } from "react";

import { board } from "./board-styles.ts";
import { useTicketMenu } from "./context-menu.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { MeasuredNode } from "./graph-node-size.tsx";
import { CardHandles, type CardProps } from "./graph-view.tsx";
import { useLaneColour } from "./state-colours.ts";
import { tonedProps } from "./state-tone.ts";
import { tableTree } from "./table-tree-styles.ts";
import {
	openParentLabel,
	stateLabel,
	subTicketsDoneLabel,
	subTicketsToggleLabel,
} from "./terms.ts";
import { TicketCardBody } from "./ticket-card.tsx";
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
	const laneColour = useLaneColour();
	const menu = useTicketMenu(
		data.ticket.outside && data.ticket.tracked
			? data.ticket.project
			: undefined,
	);
	const styles = [
		board.ticketNode,
		board.cardFocus,
		known !== undefined && board.toned,
		data.ticket.outside && board.ticketOutside,
		data.ticket.outside && known === undefined && board.ticketOutsideUntoned,
		data.open && board.ticketNodeOpen,
	];
	return (
		<>
			<button
				type="button"
				{...(known === undefined
					? stylex.props(...styles)
					: tonedProps(laneColour(data.ticket.lane), known, ...styles))}
				data-graph-node={key}
				id={`graph-card-${id}`}
				data-outside={data.ticket.outside ? "true" : "false"}
				data-state={known ?? "unknown"}
				aria-pressed={data.open}
				{...menu}
			>
				<MeasuredNode id={id} kind="ticket" />
				<CardHandles />
				<TicketCardBody
					ticket={data.ticket}
					keyLabel={shortTicket(key, data.ticket.project, data.ticket.outside)}
					labels={
						data.frame === null ? null : (
							<>
								{data.ticket.outside ? (
									<span className={clsx(board.pull)}>
										{known === undefined ? openParentLabel : stateLabel[known]}
									</span>
								) : null}
								{data.ticket.subTickets === undefined ? null : (
									<span className={clsx(board.pull)}>
										{subTicketsDoneLabel(
											data.ticket.subTicketsDone ?? 0,
											data.ticket.subTickets,
										)}
									</span>
								)}
							</>
						)
					}
					besideToggle={data.frame !== null}
					hierarchy={data.hierarchyChips}
					{...(data.parentLabel === undefined
						? {}
						: { parent: { label: data.parentLabel } })}
				/>
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
