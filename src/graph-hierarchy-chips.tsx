import { board } from "./board-styles.ts";
import type { GraphTicketView } from "./graph-model.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The parent chip and the sub-ticket count chip of a graph node. */
export function HierarchyChips({ ticket }: { ticket: GraphTicketView }) {
	if (ticket.parentLabel === undefined && ticket.subTickets === undefined) {
		return null;
	}
	const chip = clsx(board.chip, board.chipStatic, board.chipHierarchy);
	return (
		<span className={clsx(board.chips)}>
			{ticket.parentLabel === undefined ? null : (
				<span className={chip}>{parentChipLabel(ticket.parentLabel)}</span>
			)}
			{ticket.subTickets === undefined ? null : (
				<span className={chip}>{subTicketsLabel(ticket.subTickets)}</span>
			)}
		</span>
	);
}
