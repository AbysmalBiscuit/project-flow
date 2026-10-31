import type { TicketState, TrackerKind } from "./domain.ts";
import { settingsKey } from "./project-ref.ts";

// Keys compare without case, so every id folds the key to lower case.

const numberMark = "#";
const idSeparator = "\n";

const githubKeyShape = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/;

export function githubKey(repo: string, number: number | string): string {
	return `${repo}${numberMark}${number}`;
}

export function pullKey(pull: { repo: string; number: number }): string {
	return githubKey(pull.repo, pull.number);
}

/** The id of a PR across hosts: the declared host of the PR qualifies its repo. */
export function pullId(pull: {
	repo: string;
	host?: string;
	number: number;
}): string {
	return foldKey(githubKey(settingsKey(pull.repo, pull.host), pull.number));
}

export function linearKey(team: string, number: number | string): string {
	return `${team.toUpperCase()}-${number}`;
}

/** The repo and number of a GitHub key or pull key. */
export function githubKeyParts(
	key: string,
): { repo: string; number: number } | null {
	const github = key.match(githubKeyShape);
	return github?.[1] !== undefined && github[2] !== undefined
		? { repo: github[1], number: Number(github[2]) }
		: null;
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

/** A pull key as `#number` when the pull is in the repo of the ticket, else the whole key. */
export function pullRef(pull: string, ticketKey: string | null): string {
	const pullRepo = keyRepo(pull);
	const sameRepo =
		pullRepo !== null &&
		ticketKey !== null &&
		foldKey(pullRepo) === foldKey(keyRepo(ticketKey));
	return sameRepo ? shortKey(pull) : pull;
}

/** The key named with a project: `project#number` on GitHub, the whole key on Linear. */
export function outsideKey(project: string, key: string): string {
	const number = keyNumber(key);
	if (number === null || foldKey(key).startsWith(foldKey(`${project}#`))) {
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

/** An item that Needs you lists. A PR on a declared host carries the host. */
type AttentionItem = { project: string; key: string; host?: string };

/** The id of a Needs you item: the host of a PR qualifies its key. */
export function attentionItemId(item: AttentionItem): string {
	return itemId(item.project, settingsKey(item.key, item.host));
}

export function needsYouSeenId(item: AttentionItem): string {
	return id("needsYou", attentionItemId(item));
}

export function needsYouNotificationId(
	item: AttentionItem,
	at: string,
): string {
	return id(needsYouSeenId(item), at);
}

export function commentNotificationId(
	item: AttentionItem,
	stamp: string,
): string {
	return id("comment", attentionItemId(item), stamp);
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
	title: string;
	state: TicketState;
};
