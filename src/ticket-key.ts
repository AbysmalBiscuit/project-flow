import type { TicketState } from "./domain.ts";

// Keys compare without case, so every id folds the key to lower case.

export type Tracker = "github" | "linear";

export type ParsedTicketKey =
	| { tracker: "github"; repo: string; number: number }
	| { tracker: "linear"; team: string; number: number };

const numberMark = "#";
const idSeparator = "\n";

const githubKeyShape = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/;
const linearKeyShape = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export function githubKey(repo: string, number: number | string): string {
	return `${repo}${numberMark}${number}`;
}

export function pullKey(pull: { repo: string; number: number }): string {
	return githubKey(pull.repo, pull.number);
}

export function linearKey(team: string, number: number | string): string {
	return `${team.toUpperCase()}-${number}`;
}

export function parseTicketKey(key: string): ParsedTicketKey | null {
	const github = key.match(githubKeyShape);
	if (github?.[1] !== undefined && github[2] !== undefined) {
		return { tracker: "github", repo: github[1], number: Number(github[2]) };
	}
	const linear = key.match(linearKeyShape);
	if (linear?.[1] !== undefined && linear[2] !== undefined) {
		return { tracker: "linear", team: linear[1], number: Number(linear[2]) };
	}
	return null;
}

/** The repo and number of a GitHub key or pull key. */
export function githubKeyParts(
	key: string,
): { repo: string; number: number } | null {
	const parsed = parseTicketKey(key);
	return parsed?.tracker === "github" ? parsed : null;
}

/** The tracker that a key's shape names. */
export function keyTracker(key: string): Tracker {
	return key.includes(numberMark) ? "github" : "linear";
}

/** The repo of a GitHub key, or null for any other key. */
export function keyRepo(key: string): string | null {
	return githubKeyParts(key)?.repo ?? null;
}

/** The number at the end of a GitHub key or a bare `#number`. */
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

/** The key inside its own project: `#number` on GitHub, the whole key on Linear. */
export function shortKey(key: string): string {
	const mark = key.lastIndexOf(numberMark);
	return mark === -1 ? key : key.slice(mark);
}

/** The key named with a project: `project#number` on GitHub, the whole key on Linear. */
export function outsideKey(project: string, key: string): string {
	const number = keyNumber(key);
	if (
		keyTracker(key) !== "github" ||
		number === null ||
		foldKey(key).startsWith(foldKey(`${project}#`))
	) {
		return key;
	}
	return githubKey(project, number);
}

export function githubIssueUrl(key: string): string | undefined {
	const parts = githubKeyParts(key);
	return parts === null
		? undefined
		: `https://github.com/${parts.repo}/issues/${parts.number}`;
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
	tracker: Tracker;
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
	title: string;
	state: TicketState;
};
