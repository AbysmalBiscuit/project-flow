import type { ProjectGroup, Ticket, TicketRef } from "./domain.ts";
import {
	asRef,
	indexTickets,
	known,
	mergeBlockedBy,
	type ParsedBodies,
	parseKey,
	sameRef,
	stillOpen,
	type TicketIndex,
} from "./ticket-index.ts";
import { foldKey, keyRepo, ticketId } from "./ticket-key.ts";
import { parseTicketRef } from "./ticket-ref.ts";

export function heldBlockerIds(held: Ticket[]): number[] {
	return held.flatMap((ticket) => {
		if (
			ticket.state !== "open" ||
			ticket.key === null ||
			ticket.blockedBy.length === 0 ||
			!Number.isInteger(Number(ticket.id))
		) {
			return [];
		}
		return [Number(ticket.id)];
	});
}

export function refreshedBlockers(
	listed: Ticket[],
	held: Ticket[],
	refsById: Map<number, TicketRef[]>,
): Ticket[] {
	const fresh = held.flatMap((ticket) => {
		if (!Number.isInteger(Number(ticket.id))) {
			return [];
		}
		const blockedBy = refsById.get(Number(ticket.id));
		if (blockedBy === undefined) {
			return [];
		}
		const listedTicket = listed.find((item) => item.id === ticket.id);
		return [{ ...(listedTicket ?? ticket), blockedBy }];
	});
	const freshKeys = new Set(
		fresh.flatMap((ticket) => (ticket.key === null ? [] : [ticket.key])),
	);
	return [
		...listed.filter(
			(ticket) => ticket.key === null || !freshKeys.has(ticket.key),
		),
		...fresh,
	];
}

const label =
	/^(?:[-*+]|\d+[.)])?\s*(?:\*\*|__)?\s*(blocked by|blocks|blocking)(?![\p{L}\p{N}])\s*(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*(.*)$/iu;

function trimPunctuation(token: string): string {
	return token.replace(/^[([{"']+/, "").replace(/[)\]}"'.,;:!?]+$/, "");
}

function parseLine(
	line: string,
	repo: string | null,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const matched = line.trim().match(label);
	if (matched?.[1] === undefined || matched[2] === undefined) {
		return [];
	}
	const verb = matched[1].toLowerCase();
	if (
		(direction === "blockedBy" && verb !== "blocked by") ||
		(direction === "blocks" && verb === "blocked by")
	) {
		return [];
	}
	const refs: TicketRef[] = [];
	for (const raw of matched[2].split(",")) {
		const token = trimPunctuation(raw.trim());
		if (token === "" || token.toLowerCase() === "none") {
			continue;
		}
		const ref = parseTicketRef(token, repo);
		if (ref !== null && !refs.some((item) => sameRef(item, ref))) {
			refs.push(ref);
		}
	}
	return refs;
}

export function bodyBlockers(
	ticket: Ticket,
	repo: string | null,
	direction: "blockedBy" | "blocks",
): TicketRef[] {
	const refs: TicketRef[] = [];
	for (const line of ticket.body.split("\n")) {
		for (const ref of parseLine(line, repo, direction)) {
			if (!refs.some((item) => sameRef(item, ref))) {
				refs.push(ref);
			}
		}
	}
	return refs;
}

function outsideTicket(ref: TicketRef): Ticket {
	return {
		id: ref.key,
		tracker: ref.tracker,
		key: ref.key,
		title: ref.title?.trim() || ref.key,
		state: "open",
		stateReason: null,
		updatedAt: "",
		body: "",
		blockedBy: [],
		milestone: null,
		parent: null,
		labels: [],
	};
}

export function bodyLines(donor: Ticket | undefined, ticket: Ticket): string {
	if (donor === undefined || donor === ticket || ticket.body.trim() === "") {
		return "";
	}
	const lines = [];
	for (const line of donor.body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("Blocks:") || trimmed.startsWith("Blocking:")) {
			lines.push(trimmed);
		}
	}
	return lines.join("\n");
}

/** The repo that a bare `#number` in a ticket body names. */
export function bodyRepo(ticket: Ticket, repo: string | null): string | null {
	if (repo !== null || ticket.tracker !== "github" || ticket.key === null) {
		return repo;
	}
	return keyRepo(ticket.key);
}

export function parseBodies(groups: ProjectGroup[]): ParsedBodies {
	const parsed: ParsedBodies = new Map();
	for (const group of groups) {
		for (const ticket of group.tickets) {
			const key = parseKey(ticket);
			const repo = bodyRepo(ticket, group.repo);
			const blockedBy = bodyBlockers(ticket, repo, "blockedBy");
			const blocks = bodyBlockers(ticket, repo, "blocks");
			const earlier = parsed.get(key);
			if (earlier === undefined) {
				parsed.set(key, { blockedBy, blocks });
				continue;
			}
			parsed.set(key, {
				blockedBy: mergeBlockedBy([earlier.blockedBy, blockedBy]),
				blocks: mergeBlockedBy([earlier.blocks, blocks]),
			});
		}
	}
	return parsed;
}

/**
 * The tickets of every tracked project, indexed once so that the blocker and
 * link rules of each ticket look up the tickets that name it.
 */
export type TicketGraph = {
	groups: ProjectGroup[];
	index: TicketIndex;
	parsed: ParsedBodies;
	/** The project of the first group that holds each ticket. */
	homes: Map<Ticket, string>;
	/** By ticket id: the tickets whose body says that they block it. */
	bodyBlocks: Map<string, Ticket[]>;
	/** By ticket id: the held tickets whose tracker blocks name it, with those refs. */
	trackerBlocks: Map<string, { ticket: Ticket; refs: TicketRef[] }[]>;
	/** By ticket id: the held tickets that name it as a blocker, with their project. */
	blockedBy: Map<string, { ticket: Ticket; project: string }[]>;
};

function refId(ref: TicketRef): string {
	return ticketId(ref.tracker, ref.key);
}

function append<T>(map: Map<string, T[]>, id: string, item: T): void {
	const list = map.get(id);
	if (list === undefined) {
		map.set(id, [item]);
	} else {
		list.push(item);
	}
}

export function ticketGraph(groups: ProjectGroup[]): TicketGraph {
	const index = indexTickets(groups.flatMap((group) => group.tickets));
	const parsed = parseBodies(groups);
	const homes = new Map<Ticket, string>();
	const bodyBlocks = new Map<string, Ticket[]>();
	const trackerBlocks: TicketGraph["trackerBlocks"] = new Map();
	const blockedBy: TicketGraph["blockedBy"] = new Map();
	for (const [otherKey, lines] of parsed) {
		const other = index.get(otherKey);
		if (other === undefined) {
			continue;
		}
		for (const id of new Set(lines.blocks.map(refId))) {
			append(bodyBlocks, id, other);
		}
	}
	for (const group of groups) {
		for (const ticket of group.tickets) {
			if (!homes.has(ticket)) {
				homes.set(ticket, group.project);
			}
			for (const [id, refs] of Map.groupBy(ticket.blocks ?? [], refId)) {
				append(trackerBlocks, id, { ticket, refs });
			}
			const blockers = [
				...ticket.blockedBy,
				...(parsed.get(parseKey(ticket))?.blockedBy ?? []),
			];
			for (const id of new Set(blockers.map(refId))) {
				append(blockedBy, id, { ticket, project: group.project });
			}
		}
	}
	return { groups, index, parsed, homes, bodyBlocks, trackerBlocks, blockedBy };
}

export function openBlockers(ticket: Ticket, graph: TicketGraph): Ticket[] {
	const { index, parsed } = graph;
	const self = asRef(ticket);
	const merged = self === null ? undefined : known(index, self);
	const incoming = (merged?.blockedBy ?? ticket.blockedBy).filter((ref) =>
		stillOpen(ref, index),
	);
	const fromBody = (parsed.get(parseKey(ticket))?.blockedBy ?? []).filter(
		(ref) => stillOpen(ref, index),
	);
	const fromBlocks: TicketRef[] = [];
	if (self !== null) {
		for (const other of graph.bodyBlocks.get(refId(self)) ?? []) {
			const ref = asRef(other);
			if (other.state === "open" && ref !== null) {
				fromBlocks.push(ref);
			}
		}
		for (const { ticket: other, refs } of graph.trackerBlocks.get(
			refId(self),
		) ?? []) {
			if (
				other.state !== "open" ||
				other === ticket ||
				!refs.some((ref) => stillOpen(ref, index))
			) {
				continue;
			}
			const ref = asRef(other);
			if (ref !== null) {
				fromBlocks.push(ref);
			}
		}
	}
	const refs = [...incoming, ...fromBody, ...fromBlocks];
	const resolved = refs.flatMap((ref) => {
		const blocker = known(index, ref);
		if (blocker !== undefined) {
			return [blocker];
		}
		return ref.state === "open" ? [outsideTicket(ref)] : [];
	});
	return resolved.filter((blocker, position) => {
		if (
			self !== null &&
			blocker.key !== null &&
			sameRef(self, { tracker: blocker.tracker, project: "", key: blocker.key })
		) {
			return false;
		}
		return (
			resolved.findIndex(
				(item) =>
					item.tracker === blocker.tracker &&
					foldKey(item.key) === foldKey(blocker.key),
			) === position
		);
	});
}

export function blockerProject(
	blocker: Ticket,
	ref: TicketRef | undefined,
	graph: TicketGraph,
): string {
	const home = graph.homes.get(blocker);
	if (home !== undefined) {
		return home;
	}
	if (ref?.projectName !== undefined && ref.projectName.trim() !== "") {
		return ref.projectName;
	}
	if (ref?.project !== undefined && ref.project !== "") {
		return ref.project;
	}
	if (blocker.tracker === "github" && blocker.key !== null) {
		return keyRepo(blocker.key) ?? "";
	}
	return "";
}
