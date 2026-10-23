import { board } from "./board-styles.ts";
import { ServerChips } from "./card-chips.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The hierarchy chips, when shown, and the server chips of a graph node. */
export function GraphCardChips({
	ticket,
	parentLabel,
	hierarchy,
}: {
	ticket: FlowTicket;
	parentLabel: string | undefined;
	hierarchy: boolean;
}) {
	const parent = hierarchy ? parentLabel : undefined;
	const subTickets = hierarchy ? ticket.subTickets : undefined;
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
