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
import { RunLink, StageChip } from "./run-marks.tsx";
import {
	navLabel,
	parentChipLabel,
	pullRowLabel,
	subTicketsLabel,
} from "./terms.ts";
import { pullRef } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

type CardTicket = Pick<
	TicketView,
	| "key"
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
 * title and the chips. The reference rows wrap beside the marks, which keep
 * the top-right corner. Without `open`, the chips do not open tickets.
 */
export function TicketCardBody({
	ticket,
	keyLabel,
	labels,
	besideToggle = false,
	hierarchy,
	parent,
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
				<span className={clsx(board.refs)}>
					{keyLabel === null ? null : (
						<span className={clsx(board.key)}>{keyLabel}</span>
					)}
					{ticket.pull === undefined ? null : (
						<span className={clsx(board.pull)}>
							{pullRowLabel(pullRef(ticket.pull, ticket.key))}
						</span>
					)}
				</span>
				<span className={clsx(board.metaEnd)}>
					{labels}
					{fedRun === undefined ? null : <RunLink run={fedRun} />}
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
				<span className={clsx(board.chips)}>
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
