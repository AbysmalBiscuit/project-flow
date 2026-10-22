import { createContext, useContext } from "react";
import { board } from "./board-styles.ts";
import {
	type OutsideParent,
	parentChip,
	type TicketRelation,
	type TicketView,
} from "./domain.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { shell } from "./ui-styles.ts";

export function Chip({
	label,
	ticketKey,
	outside,
	hierarchy,
	onOpen,
}: {
	label: string;
	ticketKey?: string;
	outside?: boolean;
	hierarchy?: boolean;
	onOpen?: (key: string) => void;
}) {
	if (ticketKey === undefined || onOpen === undefined) {
		return (
			<span
				className={clsx(
					board.chip,
					board.chipStatic,
					hierarchy && board.chipHierarchy,
				)}
			>
				{label}
			</span>
		);
	}
	return (
		<button
			type="button"
			className={clsx(
				board.chip,
				hierarchy && board.chipHierarchy,
				outside && board.chipOutside,
				shell.buttonFocus,
			)}
			data-chip={ticketKey}
			onClick={(event) => {
				event.stopPropagation();
				onOpen(ticketKey);
			}}
		>
			{label}
			{outside ? " ↗" : ""}
		</button>
	);
}

export const OutsideParentsContext = createContext<OutsideParent[]>([]);

function ParentChip({
	parent,
	onOpen,
	onOpenOutside,
}: {
	parent: string;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	const chip = parentChip(useContext(OutsideParentsContext), parent);
	const outside = chip.outside;
	return (
		<Chip
			label={parentChipLabel(chip.label)}
			ticketKey={parent}
			hierarchy
			outside={outside !== undefined}
			onOpen={outside === undefined ? onOpen : () => onOpenOutside(outside)}
		/>
	);
}

/** The parent chip and the sub-ticket count chip of a card. */
export function CardHierarchyChips({
	ticket,
	onOpen,
	onOpenOutside,
}: {
	ticket: TicketView;
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
}) {
	return (
		<>
			{ticket.parent === undefined ? null : (
				<ParentChip
					parent={ticket.parent}
					onOpen={onOpen}
					onOpenOutside={onOpenOutside}
				/>
			)}
			{ticket.subTickets === undefined ? null : (
				<Chip label={subTicketsLabel(ticket.subTickets)} hierarchy />
			)}
		</>
	);
}
