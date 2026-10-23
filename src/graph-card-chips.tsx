import { board } from "./board-styles.ts";
import { Chip, ServerChips } from "./card-chips.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { navLabel, parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The Needs you chip, the hierarchy chips when shown, and the server chips of a graph node. */
export function GraphCardChips({
	data,
}: {
	data: { ticket: FlowTicket; parentLabel?: string; hierarchyChips: boolean };
}) {
	const { ticket, hierarchyChips } = data;
	const parent = hierarchyChips ? data.parentLabel : undefined;
	const subTickets = hierarchyChips ? ticket.subTickets : undefined;
	if (
		parent === undefined &&
		subTickets === undefined &&
		ticket.chips === undefined &&
		!ticket.needsYou
	) {
		return null;
	}
	return (
		<span className={clsx(board.chips)}>
			{ticket.needsYou ? (
				<span className={clsx(board.chip, board.chipNeeds)}>
					{navLabel.needsYou}
				</span>
			) : null}
			{parent === undefined ? null : (
				<Chip label={parentChipLabel(parent)} hierarchy />
			)}
			{subTickets === undefined ? null : (
				<Chip label={subTicketsLabel(subTickets)} hierarchy />
			)}
			<ServerChips ticket={ticket} />
		</span>
	);
}
