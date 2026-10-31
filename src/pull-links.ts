import type { PullRequest, Ticket, TrackerKind } from "./domain.ts";
import type { Forge, PullLink, PullRef } from "./ports.ts";
import {
	foldKey,
	keyNumber,
	numberedKey,
	sameTicketKey,
	teamKey,
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
				? numberedKey(namedRepo, namedNumber)
				: bareNumber !== undefined
					? numberedKey(repo, bareNumber)
					: team !== undefined && linearNumber !== undefined
						? teamKey(team, linearNumber)
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

/** Finds the pulls that close a ticket key or name it in their branch, in pull order. */
function pullFinder(
	pulls: PullRequest[],
): (key: string, tracker: TrackerKind) => PullRequest[] {
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
	return (key, tracker) => {
		const number = keyNumber(key);
		const positions = new Set([
			...(byKey.get(foldKey(key)) ?? []),
			...(number === null ? [] : (byBranchNumber.get(number) ?? [])),
			...unnumbered.filter((position) =>
				branchLinksTicket(pulls[position]?.branch ?? "", key, tracker),
			),
		]);
		return [...positions]
			.sort((left, right) => left - right)
			.flatMap((position) => pulls[position] ?? []);
	};
}

const pullFinders = new WeakMap<PullRequest[], ReturnType<typeof pullFinder>>();

export function linked(ticket: Ticket, pulls: PullRequest[]): PullRequest[] {
	if (ticket.key === null) {
		return [];
	}
	let find = pullFinders.get(pulls);
	if (find === undefined) {
		find = pullFinder(pulls);
		pullFinders.set(pulls, find);
	}
	return find(ticket.key, ticket.tracker);
}

/** The links of each forge. The host of a URL selects its forge, and a URL that names no PR on that forge gives no link. */
export function linksByForge(
	refs: PullRef[],
	forges: ReadonlyMap<string, Forge>,
): Map<Forge, PullLink[]> {
	const links = new Map<Forge, PullLink[]>();
	for (const { url, ticketKey } of refs) {
		const parsed = URL.parse(url);
		const forge = parsed === null ? undefined : forges.get(parsed.host);
		const target = parsed === null ? null : (forge?.pullOfUrl(parsed) ?? null);
		if (forge !== undefined && target !== null) {
			links.set(forge, [...(links.get(forge) ?? []), { ...target, ticketKey }]);
		}
	}
	return links;
}

export function closesTicket(pull: PullRequest, ticket: Ticket): boolean {
	const key = ticket.key;
	if (key === null || !pull.merged) {
		return false;
	}
	return closedByBody(pull).some((item) => sameTicketKey(item, key));
}
