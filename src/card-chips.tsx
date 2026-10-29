import { createContext } from "react";

import { board } from "./board-styles.ts";
import { useTicketMenu } from "./context-menu.tsx";
import { control } from "./control-styles.ts";
import type { OutsideParent, TicketRelation, TicketView } from "./domain.ts";
import { foldKey, shortKey } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

export function Chip({
	label,
	ticketKey,
	outside,
	project,
	hierarchy,
	onOpen,
}: {
	label: string;
	ticketKey?: string;
	outside?: boolean;
	/** The tracked project of an outside ticket, which its context menu opens. */
	project?: string | undefined;
	hierarchy?: boolean;
	onOpen?: (key: string) => void;
}) {
	const menu = useTicketMenu(outside ? project : undefined);
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
				control.tint,
				hierarchy && board.chipHierarchy,
				outside && board.chipOutside,
				control.focus,
			)}
			data-chip={ticketKey}
			{...menu}
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

/** The chips that the server computes for a ticket: stale status, "Run failed" and "Blocked". */
export function ServerChips({ ticket }: { ticket: Pick<TicketView, "chips"> }) {
	return [...new Set(ticket.chips)].map((chip) => (
		<Chip key={chip} label={chip} />
	));
}

/** The chip handlers of a card or a row whose chips open tickets. */
export type ChipOpen = {
	onOpen: (key: string) => void;
	onOpenOutside: (blocker: TicketRelation) => void;
};

export function relationSplit(
	ticket: Pick<TicketView, "blockers" | "outsideBlockers">,
): {
	local: string[];
	outside: TicketRelation[];
} {
	const outside = ticket.outsideBlockers ?? [];
	const outsideKeys = new Set(outside.map((blocker) => foldKey(blocker.key)));
	return {
		local: ticket.blockers.filter(
			(blocker) => !outsideKeys.has(foldKey(blocker)),
		),
		outside,
	};
}

/**
 * One chip per open blocker: a local blocker by its short key, an outside
 * blocker by its full key. Without `open`, the chips do not open tickets.
 */
export function BlockerChips({
	local,
	outside,
	open,
}: ReturnType<typeof relationSplit> & { open: ChipOpen | undefined }) {
	return (
		<>
			{local.map((blocker) => (
				<Chip
					key={blocker}
					label={shortKey(blocker)}
					{...(open === undefined
						? {}
						: { ticketKey: blocker, onOpen: open.onOpen })}
				/>
			))}
			{outside.map((blocker) => (
				<Chip
					key={blocker.key}
					label={blocker.key}
					{...(open === undefined
						? {}
						: {
								ticketKey: blocker.key,
								outside: true,
								project: blocker.project,
								onOpen: () => open.onOpenOutside(blocker),
							})}
				/>
			))}
		</>
	);
}
