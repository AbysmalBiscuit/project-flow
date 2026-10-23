import { board } from "./board-styles.ts";
import { ServerChips } from "./card-chips.tsx";
import type { TicketNodeData } from "./graph-model.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The hierarchy chips, when shown, and the server chips of a graph node. */
export function GraphCardChips({ data }: { data: TicketNodeData }) {
	const { ticket, hierarchyChips } = data;
	const parent = hierarchyChips ? data.parentLabel : undefined;
	const subTickets = hierarchyChips ? ticket.subTickets : undefined;
	if (
		parent === undefined &&
		subTickets === undefined &&
		ticket.chips === undefined
	) {
		return null;
	}
	const chip = clsx(board.chip, board.chipStatic, board.chipHierarchy);
	return (
		<span className={clsx(board.chips)}>
			{parent === undefined ? null : (
				<span className={chip}>{parentChipLabel(parent)}</span>
			)}
			{subTickets === undefined ? null : (
				<span className={chip}>{subTicketsLabel(subTickets)}</span>
			)}
			<ServerChips ticket={ticket} />
		</span>
	);
}
