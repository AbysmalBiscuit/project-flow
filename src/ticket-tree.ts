import type { TicketView } from "./domain.ts";

type TreeTicket = Pick<TicketView, "key" | "parent" | "startsCollapsed">;

export type TreeRow<T extends TreeTicket> = {
	ticket: T;
	depth: number;
	hasSubTickets: boolean;
	startsCollapsed: boolean;
};

/**
 * The tickets in parent-first order, each sub-ticket one depth step below its
 * parent ticket. A collapsed parent ticket hides all its descendants. A ticket
 * in a parent cycle starts a tree at depth 0.
 */
export function treeRows<T extends TreeTicket>(
	tickets: readonly T[],
	collapsed: (key: string, startsCollapsed: boolean) => boolean,
): TreeRow<T>[] {
	const keys = new Set(
		tickets.flatMap((ticket) =>
			ticket.key === null ? [] : [ticket.key.toLowerCase()],
		),
	);
	const parentKey = (ticket: T) => {
		const parent = ticket.parent?.toLowerCase();
		return parent !== undefined &&
			keys.has(parent) &&
			parent !== ticket.key?.toLowerCase()
			? parent
			: undefined;
	};
	const subTicketsOf = new Map<string, T[]>();
	for (const ticket of tickets) {
		const parent = parentKey(ticket);
		if (parent === undefined) {
			continue;
		}
		const known = subTicketsOf.get(parent);
		if (known === undefined) {
			subTicketsOf.set(parent, [ticket]);
		} else {
			known.push(ticket);
		}
	}
	const subTickets = (ticket: T) =>
		ticket.key === null
			? []
			: (subTicketsOf.get(ticket.key.toLowerCase()) ?? []);
	const rows: TreeRow<T>[] = [];
	const seen = new Set<T>();
	const visit = (ticket: T, depth: number, hidden: boolean) => {
		if (seen.has(ticket)) {
			return;
		}
		seen.add(ticket);
		const below = subTickets(ticket);
		const startsCollapsed = ticket.startsCollapsed ?? false;
		if (!hidden) {
			rows.push({
				ticket,
				depth,
				hasSubTickets: below.length > 0,
				startsCollapsed,
			});
		}
		const shut =
			hidden ||
			(ticket.key !== null &&
				below.length > 0 &&
				collapsed(ticket.key, startsCollapsed));
		for (const sub of below) {
			visit(sub, depth + 1, shut);
		}
	};
	for (const ticket of tickets) {
		if (parentKey(ticket) === undefined) {
			visit(ticket, 0, false);
		}
	}
	for (const ticket of tickets) {
		visit(ticket, 0, false);
	}
	return rows;
}
