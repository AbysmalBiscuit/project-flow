import { claimTickets } from "./discovery.ts";
import type {
	FetchStatus,
	PollReconcile,
	ProjectPoll,
	PullRequest,
	Snapshot,
	Ticket,
} from "./domain.ts";
import {
	listedRef,
	projectId,
	type ProjectRef,
	sameProject,
} from "./project-ref.ts";
import { linked } from "./pull-links.ts";
import { foldKey, pullId, ticketId } from "./ticket-key.ts";

export function staleView(
	status: FetchStatus,
	goodPollAt: string | null,
): FetchStatus {
	if (status.error === null) {
		return { fetchedAt: status.fetchedAt, error: null };
	}
	if (goodPollAt === null) {
		return { fetchedAt: status.fetchedAt, error: status.error };
	}
	return {
		fetchedAt: goodPollAt,
		error: `${status.error} (stale since ${goodPollAt})`,
	};
}

function ticketIdentity(ticket: Ticket): string {
	return ticket.key === null ? ticket.id : ticketId(ticket.tracker, ticket.key);
}

export function mergeTickets(stored: Ticket[], incoming: Ticket[]): Ticket[] {
	const byId = new Map(
		stored.map((ticket) => [ticketIdentity(ticket), ticket]),
	);
	for (const ticket of incoming) {
		byId.set(ticketIdentity(ticket), ticket);
	}
	return [...byId.values()];
}

/**
 * The stored merged pulls that a full read left out and that still link one
 * of its tickets, marked `retained`. The read takes one page of merged pulls,
 * and a merged pull does not change, so an older closed ticket keeps its link.
 */
function retainedPulls(
	stored: PullRequest[],
	incomingIds: Set<string>,
	tickets: Ticket[],
): PullRequest[] {
	const missed = stored.filter(
		(pull) => pull.merged && !incomingIds.has(pullId(pull)),
	);
	const linkedPulls = new Set(
		tickets.flatMap((ticket) => linked(ticket, missed)),
	);
	return missed
		.filter((pull) => linkedPulls.has(pull))
		.map((pull) => ({ ...pull, retained: true as const }));
}

function keptPulls(
	stored: PullRequest[],
	incoming: PullRequest[],
	returnedIds: Set<string>,
	tickets: Ticket[],
	full: boolean,
): PullRequest[] {
	const incomingIds = new Set(incoming.map((pull) => pullId(pull)));
	if (full) {
		return [...incoming, ...retainedPulls(stored, incomingIds, tickets)];
	}
	const incomingKeys = new Set(
		incoming.flatMap((pull) => pull.closingKeys.map((key) => foldKey(key))),
	);
	const storedById = new Map(
		stored.map((pull) => [foldKey(pullKey(pull)), pull]),
	);
	// An incremental read names only the links of the tickets that it returned,
	// so a pull that it read again keeps the links of the unchanged tickets.
	const withUnchangedLinks = (pull: PullRequest): PullRequest => {
		const unchanged = (
			storedById.get(foldKey(pullKey(pull)))?.closingKeys ?? []
		).filter(
			(key) =>
				!returnedIds.has(foldKey(key)) &&
				!pull.closingKeys.some((held) => foldKey(held) === foldKey(key)),
		);
		return unchanged.length === 0
			? pull
			: { ...pull, closingKeys: [...pull.closingKeys, ...unchanged] };
	};
	// An incremental read can leave out the merged pulls of unchanged tickets,
	// so it keeps each stored merged pull as the store holds it.
	return [
		...incoming.map(withUnchangedLinks),
		...stored.filter(
			(pull) =>
				!incomingIds.has(pullId(pull)) &&
				(pull.merged ||
					!pull.closingKeys.some(
						(key) =>
							returnedIds.has(foldKey(key)) || incomingKeys.has(foldKey(key)),
					)),
		),
	];
}

export function reconcilePoll(
	previous: Snapshot[],
	outcomes: ProjectPoll[],
	fullPolled: boolean,
): PollReconcile {
	const rows: Snapshot[] = [];
	const projectErrors: PollReconcile["projectErrors"] = [];
	const seen = new Set<string>();
	const priorOf = (ref: ProjectRef) =>
		previous.find((row) => sameProject(listedRef(row), ref));
	for (const outcome of outcomes) {
		seen.add(projectId(outcome.ref));
		if (outcome.ok) {
			if (outcome.row === null) {
				continue;
			}
			const prior = priorOf(outcome.ref);
			const tickets = outcome.full
				? outcome.row.tickets
				: mergeTickets(prior?.tickets ?? [], outcome.row.tickets);
			const returnedIds = new Set(
				outcome.row.tickets.flatMap((ticket) =>
					ticket.key === null ? [] : [foldKey(ticket.key)],
				),
			);
			const listedEmpty = outcome.full
				? outcome.row.listedEmpty
				: (prior?.listedEmpty ?? outcome.row.listedEmpty);
			rows.push({
				...outcome.row,
				tickets,
				pulls: keptPulls(
					prior?.pulls ?? [],
					outcome.row.pulls,
					returnedIds,
					tickets,
					outcome.full,
				),
				...(listedEmpty === undefined ? {} : { listedEmpty }),
			});
			continue;
		}
		if (outcome.error !== null) {
			projectErrors.push({ ref: outcome.ref, error: outcome.error });
		}
		const prior = priorOf(outcome.ref);
		if (prior !== undefined) {
			rows.push(prior);
			continue;
		}
		if (outcome.row === null || outcome.error === null) {
			continue;
		}
		rows.push(outcome.row);
	}
	for (const row of previous) {
		if (seen.has(projectId(listedRef(row))) || fullPolled) {
			continue;
		}
		rows.push(row);
	}
	const failed = outcomes.find(
		(outcome) =>
			!outcome.ok &&
			outcome.error !== null &&
			!rows.some((row) => sameProject(listedRef(row), outcome.ref)),
	);
	const globalError = failed?.error ?? null;
	const fresh = new Set(
		outcomes.flatMap((outcome) =>
			outcome.ok && outcome.row !== null ? outcome.row.tickets : [],
		),
	);
	return { rows: claimTickets(rows, fresh), projectErrors, globalError };
}
