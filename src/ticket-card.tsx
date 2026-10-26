import type { ReactNode } from "react";

import { board } from "./board-styles.ts";
import {
	BlockerChips,
	Chip,
	type ChipOpen,
	relationSplit,
	ServerChips,
} from "./card-chips.tsx";
import type { OutsideParent, TicketView } from "./domain.ts";
import { RunDot, StageChip } from "./run-marks.tsx";
import { navLabel, parentChipLabel, subTicketsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

type CardTicket = Pick<
	TicketView,
	| "title"
	| "blockers"
	| "outsideBlockers"
	| "chips"
	| "pull"
	| "needsYou"
	| "factoryRun"
	| "parent"
	| "subTickets"
>;

/**
 * The body of a ticket card on the board and in the graph: the key line, the
 * title and the chips. Without `open`, the chips do not open tickets.
 */
export function TicketCardBody({
	ticket,
	keyLabel,
	labels,
	besideToggle = false,
	hierarchy,
	parent,
	oneRow = false,
	open,
}: {
	ticket: CardTicket;
	keyLabel: string | null;
	/** More labels after the pull request on the key line. */
	labels?: ReactNode;
	besideToggle?: boolean;
	/** The card shows the parent chip and the sub-ticket count chip. */
	hierarchy: boolean;
	parent?: { label: string; outside?: OutsideParent };
	oneRow?: boolean;
	open?: ChipOpen;
}) {
	const { local, outside } = relationSplit(ticket);
	const fedRun = ticket.factoryRun?.coveredByFeed
		? ticket.factoryRun
		: undefined;
	const parentKey = hierarchy ? ticket.parent : undefined;
	const subTickets = hierarchy ? ticket.subTickets : undefined;
	const outsideParent = parent?.outside;
	return (
		<>
			<span
				className={clsx(board.meta, besideToggle && board.metaBesideToggle)}
			>
				{keyLabel === null ? (
					<span />
				) : (
					<span className={clsx(board.key)}>{keyLabel}</span>
				)}
				<span className={clsx(board.metaEnd)}>
					{ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>{ticket.pull}</span>
					)}
					{labels}
					{fedRun === undefined ? null : <RunDot run={fedRun} />}
				</span>
			</span>
			<span className={clsx(board.title)}>{ticket.title}</span>
			{local.length === 0 &&
			outside.length === 0 &&
			ticket.chips === undefined &&
			parentKey === undefined &&
			subTickets === undefined &&
			fedRun?.stage === undefined &&
			!ticket.needsYou ? null : (
				<span className={clsx(board.chips, oneRow && board.chipsRow)}>
					{fedRun?.stage === undefined ? null : (
						<StageChip stage={fedRun.stage} />
					)}
					{parentKey === undefined || parent === undefined ? null : (
						<Chip
							label={parentChipLabel(parent.label)}
							hierarchy
							{...(open === undefined
								? {}
								: {
										ticketKey: parentKey,
										outside: outsideParent !== undefined,
										onOpen:
											outsideParent === undefined
												? open.onOpen
												: () => open.onOpenOutside(outsideParent),
									})}
						/>
					)}
					{subTickets === undefined ? null : (
						<Chip label={subTicketsLabel(subTickets)} hierarchy />
					)}
					<ServerChips ticket={ticket} />
					<BlockerChips local={local} outside={outside} open={open} />
					{ticket.needsYou ? (
						<span className={clsx(board.chip, board.chipNeedsPill)}>
							{navLabel.needsYou}
						</span>
					) : null}
				</span>
			)}
		</>
	);
}
