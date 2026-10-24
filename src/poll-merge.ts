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
import { foldKey, pullKey, ticketId } from "./ticket-key.ts";

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

function keptPulls(
	stored: PullRequest[],
	incoming: PullRequest[],
	returnedIds: Set<string>,
	full: boolean,
): PullRequest[] {
	if (full) {
		return incoming;
	}
	const incomingIds = new Set(incoming.map((pull) => foldKey(pullKey(pull))));
	const incomingKeys = new Set(
		incoming.flatMap((pull) => pull.closingKeys.map((key) => foldKey(key))),
	);
	return [
		...incoming,
		...stored.filter(
			(pull) =>
				!incomingIds.has(foldKey(pullKey(pull))) &&
				!pull.closingKeys.some(
					(key) =>
						returnedIds.has(foldKey(key)) || incomingKeys.has(foldKey(key)),
				),
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
