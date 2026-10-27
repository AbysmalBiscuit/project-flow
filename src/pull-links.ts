import type { PullRequest, Ticket } from "./domain.ts";
import {
	foldKey,
	githubKey,
	keyNumber,
	keyTracker,
	linearKey,
	sameTicketKey,
} from "./ticket-key.ts";

const closing =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)|#(\d+)|([A-Za-z][A-Za-z0-9]*)-(\d+))\b/gi;

function closingKeys(body: string, repo: string): string[] {
	const keys: string[] = [];
	for (const match of body.matchAll(closing)) {
		const namedRepo = match[1];
		const namedNumber = match[2];
		const bareNumber = match[3];
		const team = match[4];
		const linearNumber = match[5];
		const key =
			namedRepo !== undefined && namedNumber !== undefined
				? githubKey(namedRepo, namedNumber)
				: bareNumber !== undefined
					? githubKey(repo, bareNumber)
					: team !== undefined && linearNumber !== undefined
						? linearKey(team, linearNumber)
						: null;
		if (key !== null && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

const bodyClosingKeys = new WeakMap<PullRequest, string[]>();

/** The keys that the body of a pull closes, parsed once for each pull. */
function closedByBody(pull: PullRequest): string[] {
	const stored = bodyClosingKeys.get(pull);
	if (stored !== undefined) {
		return stored;
	}
	const keys = closingKeys(pull.body, pull.repo);
	bodyClosingKeys.set(pull, keys);
	return keys;
}

const leadingNumber = /^(?:[^/]+\/)?(\d+)-/;

export function branchLinksTicket(branch: string, key: string): boolean {
	const number = keyNumber(key);
	const leading = branch.match(leadingNumber)?.[1];
	if (leading !== undefined) {
		return number !== null && leading === number;
	}
	return keyTracker(key) === "github" && foldKey(branch).includes(foldKey(key));
}

/** Finds the pulls that close a ticket key or name it in their branch, in pull order. */
function pullFinder(pulls: PullRequest[]): (key: string) => PullRequest[] {
	const byKey = new Map<string, number[]>();
	const byBranchNumber = new Map<string, number[]>();
	const unnumbered: number[] = [];
	pulls.forEach((pull, position) => {
		const keys = new Set(
			[...pull.closingKeys, ...closedByBody(pull)].map((key) => foldKey(key)),
		);
		for (const key of keys) {
			byKey.set(key, [...(byKey.get(key) ?? []), position]);
		}
		const leading = pull.branch.match(leadingNumber)?.[1];
		if (leading === undefined) {
			unnumbered.push(position);
		} else {
			byBranchNumber.set(leading, [
				...(byBranchNumber.get(leading) ?? []),
				position,
			]);
		}
	});
	return (key) => {
		const number = keyNumber(key);
		const positions = new Set([
			...(byKey.get(foldKey(key)) ?? []),
			...(number === null ? [] : (byBranchNumber.get(number) ?? [])),
			...unnumbered.filter((position) =>
				branchLinksTicket(pulls[position]?.branch ?? "", key),
			),
		]);
		return [...positions]
			.sort((left, right) => left - right)
			.flatMap((position) => pulls[position] ?? []);
	};
}

const pullFinders = new WeakMap<
	PullRequest[],
	(key: string) => PullRequest[]
>();

export function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	let find = pullFinders.get(pulls);
	if (find === undefined) {
		find = pullFinder(pulls);
		pullFinders.set(pulls, find);
	}
	return find(ticket.key);
}

export function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	return closedByBody(pull).some((item) => sameTicketKey(item, key));
}
