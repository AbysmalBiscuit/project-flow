import { board } from "./board-styles.ts";
import type { FlowTicket } from "./graph-flow.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The parent chip and the sub-ticket count chip of a graph node. */
export function HierarchyChips({
	ticket,
	parentLabel,
}: {
	ticket: FlowTicket;
	parentLabel: string | undefined;
}) {
	if (parentLabel === undefined && ticket.subTickets === undefined) {
		return null;
	}
	const chip = clsx(board.chip, board.chipStatic, board.chipHierarchy);
	return (
		<span className={clsx(board.chips)}>
			{parentLabel === undefined ? null : (
				<span className={chip}>{parentChipLabel(parentLabel)}</span>
			)}
			{ticket.subTickets === undefined ? null : (
				<span className={chip}>{subTicketsLabel(ticket.subTickets)}</span>
			)}
		</span>
	);
}
