import type { Ticket, TicketRef } from "./domain.ts";
import { sameTicketKey, ticketId } from "./ticket-key.ts";

export function sameRef(left: TicketRef, right: TicketRef): boolean {
	return left.tracker === right.tracker && sameTicketKey(left.key, right.key);
}

export function mergeBlockedBy(rows: TicketRef[][]): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const row of rows) {
		for (const ref of row) {
			const earlier = refs.findIndex((item) => sameRef(item, ref));
			if (earlier === -1) {
				refs.push(ref);
				continue;
			}
			const kept = refs[earlier];
			if (kept === undefined) {
				continue;
			}
			if (ref.state === "open" && kept.state === "closed") {
				refs[earlier] = ref;
				continue;
			}
			if (ref.state === "closed" && kept.state !== "closed") {
				refs[earlier] = ref;
			}
		}
	}
	return refs;
}

export type TicketIndex = Map<string, Ticket>;

export function indexTickets(tickets: Ticket[]): TicketIndex {
	const index = new Map<string, Ticket>();
	for (const ticket of tickets) {
		if (ticket.key === null) {
			continue;
		}
		const key = ticketId(ticket.tracker, ticket.key);
		const earlier = index.get(key);
		if (earlier === undefined) {
			index.set(key, ticket);
			continue;
		}
		index.set(key, {
			...earlier,
			body: earlier.body.trim() === "" ? ticket.body : earlier.body,
			blockedBy: mergeBlockedBy([earlier.blockedBy, ticket.blockedBy]),
			blocks: mergeBlockedBy([earlier.blocks ?? [], ticket.blocks ?? []]),
		});
	}
	return index;
}

export function known(index: TicketIndex, ref: TicketRef): Ticket | undefined {
	return index.get(ticketId(ref.tracker, ref.key));
}

export function stillOpen(ref: TicketRef, index: TicketIndex): boolean {
	const ticket = known(index, ref);
	if (ticket !== undefined && ticket.state === "open") {
		return true;
	}
	if (ref.state === "closed") {
		return false;
	}
	if (ticket !== undefined) {
		return ticket.state === "open";
	}
	return ref.state === "open";
}

export function asRef(ticket: Ticket): TicketRef | null {
	if (ticket.key === null) {
		return null;
	}
	return { tracker: ticket.tracker, project: "", key: ticket.key };
}

export type ParsedBodies = Map<
	string,
	{ blockedBy: TicketRef[]; blocks: TicketRef[] }
>;

export function parseKey(ticket: Ticket): string {
	return ticketId(ticket.tracker, ticket.key ?? "");
}
