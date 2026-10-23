import type { ProjectGroup, Ticket, TicketRef } from "./domain.ts";
import {
	asRef,
	known,
	mergeBlockedBy,
	type ParsedBodies,
	parseKey,
	sameRef,
	stillOpen,
	type TicketIndex,
} from "./ticket-index.ts";
import { foldKey, githubKey, keyRepo } from "./ticket-key.ts";

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

const anchoredRef =
	/^(?:https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)|https?:\/\/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]+-\d+)(?:\/[^\s)]*)?|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]+-\d+))$/i;

function trimPunctuation(token: string): string {
	return token.replace(/^[([{"']+/, "").replace(/[)\]}"'.,;:!?]+$/, "");
}

function refFrom(
	match: RegExpExecArray,
	repo: string | null,
): TicketRef | null {
	const githubUrlOwner = match[1];
	const githubUrlRepo = match[2];
	const githubUrlNumber = match[3];
	if (
		githubUrlOwner !== undefined &&
		githubUrlRepo !== undefined &&
		githubUrlNumber !== undefined
	) {
		const repo = `${githubUrlOwner}/${githubUrlRepo}`;
		return {
			tracker: "github",
			project: repo,
			key: githubKey(repo, githubUrlNumber),
		};
	}
	const linearUrlKey = match[4];
	if (linearUrlKey !== undefined) {
		return { tracker: "linear", project: "", key: linearUrlKey.toUpperCase() };
	}
	const ownerRepo = match[5];
	const ownerNumber = match[6];
	if (ownerRepo !== undefined && ownerNumber !== undefined) {
		return {
			tracker: "github",
			project: ownerRepo,
			key: githubKey(ownerRepo, ownerNumber),
		};
	}
	const sameNumber = match[7];
	if (sameNumber !== undefined) {
		if (repo === null) {
			return null;
		}
		return {
			tracker: "github",
			project: repo,
			key: githubKey(repo, sameNumber),
		};
	}
	const linearMatch = match[8];
	if (linearMatch !== undefined) {
		return { tracker: "linear", project: "", key: linearMatch.toUpperCase() };
	}
	return null;
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
		const found = anchoredRef.exec(token);
		if (found === null) {
			continue;
		}
		const ref = refFrom(found, repo);
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

export function openBlockers(
	ticket: Ticket,
	index: TicketIndex,
	parsed: ParsedBodies,
	groups: { project: string; tickets: Ticket[] }[] = [],
): Ticket[] {
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
		for (const [otherKey, lines] of parsed) {
			const other = index.get(otherKey);
			if (other === undefined || other.state !== "open") {
				continue;
			}
			if (!lines.blocks.some((ref) => sameRef(ref, self))) {
				continue;
			}
			const ref = asRef(other);
			if (ref !== null) {
				fromBlocks.push(ref);
			}
		}
		for (const group of groups) {
			for (const other of group.tickets) {
				if (other.state !== "open" || other === ticket) {
					continue;
				}
				const native = other.blocks ?? [];
				if (
					!native.some((ref) => sameRef(ref, self) && stillOpen(ref, index))
				) {
					continue;
				}
				const ref = asRef(other);
				if (ref !== null) {
					fromBlocks.push(ref);
				}
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
	groups: { project: string; tickets: Ticket[] }[],
): string {
	const home = groups.find((group) => group.tickets.includes(blocker))?.project;
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
