import type { PullRequest, Ticket, TrackerKind } from "./domain.ts";
import { bodyLinks, type LinkRelation } from "./link-words.ts";
import type { Forge, PullLink, PullRef, PullTarget } from "./ports.ts";
import { foldKey, keyNumber, keyRepo, sameTicketKey } from "./ticket-key.ts";

/**
 * The folded keys that a PR body closes under the words of `tracker`, in body
 * order. A bare `#number` takes `repo`.
 */
export function closingKeys(
	body: string,
	repo: string,
	tracker: TrackerKind,
): string[] {
	return closedIn(bodyLinks(body, repo, tracker));
}

function closedIn(links: Map<string, Set<LinkRelation>>): string[] {
	return [...links]
		.filter(([, relations]) => relations.has("closes"))
		.map(([key]) => key);
}

const bodyLinkTable = new WeakMap<
	PullRequest,
	Map<TrackerKind, Map<string, Set<LinkRelation>>>
>();

/** The links of a pull body under the link words of `tracker`, parsed once per pull and tracker. */
function linksOf(
	pull: PullRequest,
	tracker: TrackerKind,
): Map<string, Set<LinkRelation>> {
	let byTracker = bodyLinkTable.get(pull);
	if (byTracker === undefined) {
		byTracker = new Map();
		bodyLinkTable.set(pull, byTracker);
	}
	const stored = byTracker.get(tracker);
	if (stored !== undefined) {
		return stored;
	}
	const links = bodyLinks(pull.body, pull.repo, tracker);
	byTracker.set(tracker, links);
	return links;
}

/** The folded keys that the body of a pull closes under the words of `tracker`. */
function closedByBody(pull: PullRequest, tracker: TrackerKind): string[] {
	return closedIn(linksOf(pull, tracker));
}

const leadingNumber = /^(?:[^/]+\/)?(\d+)-/;

export function branchLinksTicket(
	branch: string,
	key: string,
	tracker: TrackerKind,
): boolean {
	const number = keyNumber(key);
	const leading = branch.match(leadingNumber)?.[1];
	if (leading !== undefined) {
		return number !== null && leading === number;
	}
	return tracker === "github" && foldKey(branch).includes(foldKey(key));
}

type PullsOfKey = { closes: PullRequest[]; refs: PullRequest[] };

/**
 * Finds the pulls of one tracker's ticket key: the pulls that close the key or
 * name it in their branch, and the pulls that only reference it, each in pull
 * order. A pull whose body references a key without closing it never closes
 * that key, whatever else names the key.
 */
function pullFinder(
	pulls: PullRequest[],
	tracker: TrackerKind,
): (key: string) => PullsOfKey {
	const byKey = new Map<string, number[]>();
	const byReference = new Map<string, number[]>();
	const byBranchNumber = new Map<string, number[]>();
	const unnumbered: number[] = [];
	pulls.forEach((pull, position) => {
		const links = linksOf(pull, tracker);
		for (const [key, relations] of links) {
			if (!relations.has("closes")) {
				byReference.set(key, [...(byReference.get(key) ?? []), position]);
			}
		}
		const keys = new Set([
			...pull.closingKeys.map((key) => foldKey(key)),
			...closedByBody(pull, tracker),
		]);
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
		const referencing = new Set(byReference.get(foldKey(key)) ?? []);
		const closing = new Set(
			[
				...(byKey.get(foldKey(key)) ?? []),
				...(number === null ? [] : (byBranchNumber.get(number) ?? [])),
				...unnumbered.filter((position) =>
					branchLinksTicket(pulls[position]?.branch ?? "", key, tracker),
				),
			].filter((position) => !referencing.has(position)),
		);
		const inPullOrder = (positions: Set<number>) =>
			[...positions]
				.sort((left, right) => left - right)
				.flatMap((position) => pulls[position] ?? []);
		return {
			closes: inPullOrder(closing),
			refs: inPullOrder(referencing),
		};
	};
}

const pullFinders = new WeakMap<
	PullRequest[],
	Map<TrackerKind, ReturnType<typeof pullFinder>>
>();

function findPulls(ticket: Ticket, pulls: PullRequest[]): PullsOfKey {
	if (ticket.key === null) {
		return { closes: [], refs: [] };
	}
	let finders = pullFinders.get(pulls);
	if (finders === undefined) {
		finders = new Map();
		pullFinders.set(pulls, finders);
	}
	let find = finders.get(ticket.tracker);
	if (find === undefined) {
		find = pullFinder(pulls, ticket.tracker);
		finders.set(ticket.tracker, find);
	}
	return find(ticket.key);
}

/** The pulls that close the ticket, in pull order. */
export function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	return findPulls(ticket, pulls).closes;
}

/**
 * The pulls that name the ticket without closing it, in pull order. Such a pull
 * is linked to the ticket but does not set its state.
 */
export function referencing(
	ticket: Ticket,
	pulls: PullRequest[],
): PullRequest[] {
	return findPulls(ticket, pulls).refs;
}

/**
 * The links of each forge. The host of a URL selects its forge, and a URL that
 * names no PR on that forge gives no link. `missing` holds the missing-token
 * messages of the URLs that name a PR on a forge without a token.
 */
export function linksByForge(
	refs: PullRef[],
	linkOf: (
		url: URL,
	) => { forge: Forge; target: PullTarget } | { error: string } | null,
): { links: Map<Forge, PullLink[]>; missing: string | null } {
	const links = new Map<Forge, PullLink[]>();
	const missing = new Set<string>();
	for (const { url, ticketKey } of refs) {
		const parsed = URL.parse(url);
		const link = parsed === null ? null : linkOf(parsed);
		if (link === null) {
			continue;
		}
		if ("error" in link) {
			missing.add(link.error);
			continue;
		}
		const { forge, target } = link;
		links.set(forge, [...(links.get(forge) ?? []), { ...target, ticketKey }]);
	}
	return { links, missing: missing.size === 0 ? null : [...missing].join(" ") };
}

/**
 * True when a merged pull's body closes the ticket. A Forgejo ticket key
 * carries its host, so a repo key of the body takes the host of the pull.
 */
export function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	const hosted = ticket.tracker === "forgejo" ? pull.host : undefined;
	return closedByBody(pull, ticket.tracker).some((item) =>
		sameTicketKey(
			hosted === undefined || keyRepo(item) === null
				? item
				: `${hosted}/${item}`,
			key,
		),
	);
}
