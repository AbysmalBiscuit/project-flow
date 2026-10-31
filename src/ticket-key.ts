import type { TicketState, TrackerKind } from "./domain.ts";

// Keys compare without case, so every id folds the key to lower case.

const numberMark = "#";
const idSeparator = "\n";

const numberedKeyShape = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/;

export function numberedKey(repo: string, number: number | string): string {
	return `${repo}${numberMark}${number}`;
}

export function pullKey(pull: { repo: string; number: number }): string {
	return numberedKey(pull.repo, pull.number);
}

export function teamKey(team: string, number: number | string): string {
	return `${team.toUpperCase()}-${number}`;
}

/** The repo and number of an `owner/name#number` key. */
export function numberedKeyParts(
	key: string,
): { repo: string; number: number } | null {
	const parts = key.match(numberedKeyShape);
	return parts?.[1] !== undefined && parts[2] !== undefined
		? { repo: parts[1], number: Number(parts[2]) }
		: null;
}

/** The repo of an `owner/name#number` key, or null for any other key. */
export function keyRepo(key: string): string | null {
	return numberedKeyParts(key)?.repo ?? null;
}

/** The number at the end of an `owner/name#number` key or a bare `#number`. */
export function keyNumber(key: string): string | null {
	const number = key.slice(key.lastIndexOf(numberMark) + 1);
	return /^\d+$/.test(number) ? number : null;
}

/** A bare `#number` takes the repo. Any other key stays as it is. */
export function scopedKey(repo: string, key: string): string {
	return key.startsWith(numberMark) ? `${repo}${key}` : key;
}

export function foldKey(key: string): string;
export function foldKey(key: string | null | undefined): string | undefined;
export function foldKey(key: string | null | undefined): string | undefined {
	return key?.toLowerCase();
}

export function sameTicketKey(left: string, right: string): boolean {
	return foldKey(left) === foldKey(right);
}

/** The key inside its own project: `#number` for a numbered key, else the whole key. */
export function shortKey(key: string): string {
	const mark = key.lastIndexOf(numberMark);
	return mark === -1 ? key : key.slice(mark);
}

/** A pull key as `#number` when the pull is in the repo of the ticket, else the whole key. */
export function pullRef(pull: string, ticketKey: string | null): string {
	const pullRepo = keyRepo(pull);
	const sameRepo =
		pullRepo !== null &&
		ticketKey !== null &&
		foldKey(pullRepo) === foldKey(keyRepo(ticketKey));
	return sameRepo ? shortKey(pull) : pull;
}

/** The key named with a project: `project#number` for a numbered key, else the whole key. */
export function outsideKey(project: string, key: string): string {
	const number = keyNumber(key);
	if (number === null || foldKey(key).startsWith(foldKey(`${project}#`))) {
		return key;
	}
	return numberedKey(project, number);
}

function id(...parts: string[]): string {
	return parts.join(idSeparator);
}

/** The id of a ticket across every project. */
export function ticketId(tracker: string, key: string): string {
	return id(tracker, foldKey(key));
}

/** The id of a ticket or pull inside one project. */
export function itemId(project: string, key: string): string {
	return id(project, foldKey(key));
}

/** The id of a link between two item ids. */
export function linkId(from: string, to: string): string {
	return id(from, to);
}

/** The id of a ticket in one project of one tracker. */
export function ticketRefId(ref: {
	project: string;
	tracker: string;
	key: string;
}): string {
	return id(ref.project, ref.tracker, foldKey(ref.key));
}

export function needsYouSeenId(item: { project: string; key: string }): string {
	return id("needsYou", itemId(item.project, item.key));
}

export function needsYouNotificationId(
	item: { project: string; key: string },
	at: string,
): string {
	return id(needsYouSeenId(item), at);
}

export function commentNotificationId(
	item: { project: string; key: string },
	stamp: string,
): string {
	return id("comment", itemId(item.project, item.key), stamp);
}

export function blockerClearedId(
	blocker: { project: string; tracker: string; key: string },
	at: string,
): string {
	return id("blockerCleared", ticketRefId(blocker), at);
}

export type TicketRef = {
	tracker: TrackerKind;
	project: string;
	key: string;
};

export function sameTicket(left: TicketRef, right: TicketRef): boolean {
	return (
		left.tracker === right.tracker &&
		left.project === right.project &&
		sameTicketKey(left.key, right.key)
	);
}

export type TicketSearchHit = TicketRef & {
	/** The page of the ticket on its tracker. */
	url?: string;
	title: string;
	state: TicketState;
};
