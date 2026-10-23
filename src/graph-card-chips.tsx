import { board } from "./board-styles.ts";
import { Chip, ServerChips } from "./card-chips.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** The hierarchy chips, when shown, and the server chips of a graph node. */
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
		ticket.chips === undefined
	) {
		return null;
	}
	return (
		<span className={clsx(board.chips)}>
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
