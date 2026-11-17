/** The words that link a PR to its tickets, as each tracker reads them. */

import type { TrackerKind } from "./domain.ts";
import {
	foldKey,
	numberedKey,
	repoPathPattern,
	teamKey,
} from "./ticket-key.ts";

/**
 * What a PR body says about a ticket. `closes` moves the ticket state, while
 * `contributes` and `relates` only name the ticket.
 */
export type LinkRelation = "closes" | "contributes" | "relates";

/**
 * The stems with their -s, -ed and, when `ing` is set, -ing forms. A stem
 * that ends in `x` takes `-es`, and a final `e` drops before `-ed` and `-ing`.
 */
function forms(stems: string[], ing: boolean): string[] {
	return stems.flatMap((stem) => {
		const base = stem.replace(/e$/, "");
		const plural = /x$/.test(stem) ? `${stem}es` : `${stem}s`;
		return [stem, plural, `${base}ed`, ...(ing ? [`${base}ing`] : [])];
	});
}

type RefSyntax = {
	/** The regex source of one ref, with no capture groups. */
	source: string;
	/** The keys of the refs in a matched list of refs. */
	keysIn: (text: string, repo: string) => string[];
};

const forgeRefToken = new RegExp(
	String.raw`(?:(${repoPathPattern})#(\d+)|#(\d+))`,
	"g",
);

const forgeRefs: RefSyntax = {
	source: String.raw`(?:${repoPathPattern})#\d+|#\d+`,
	keysIn: (text, repo) =>
		[...text.matchAll(forgeRefToken)].flatMap((match) => {
			const [, namedRepo, namedNumber, bareNumber] = match;
			if (namedRepo !== undefined && namedNumber !== undefined) {
				return [numberedKey(namedRepo, namedNumber)];
			}
			return bareNumber === undefined ? [] : [numberedKey(repo, bareNumber)];
		}),
};

const linearRefToken = /([A-Za-z][A-Za-z0-9]*)-(\d+)/g;

const linearRefs: RefSyntax = {
	source: String.raw`[A-Za-z][A-Za-z0-9]*-\d+`,
	keysIn: (text) =>
		[...text.matchAll(linearRefToken)].flatMap(([, team, number]) =>
			team === undefined || number === undefined ? [] : [teamKey(team, number)],
		),
};

type LinkTable = { relation: LinkRelation; words: string[] };

/** The link words of one tracker, with the ref syntax that they take. */
type LinkWords = {
	refs: RefSyntax;
	/** Whether one link word may take a list of refs, such as `Closes WID-1, WID-2 and WID-3`. */
	lists: boolean;
	tables: LinkTable[];
};

const forgeWords: LinkWords = {
	refs: forgeRefs,
	lists: false,
	tables: [
		{ relation: "closes", words: forms(["close", "fix", "resolve"], false) },
	],
};

const gitlabWords: LinkWords = {
	refs: forgeRefs,
	lists: true,
	tables: [
		{
			relation: "closes",
			words: forms(["close", "fix", "resolve", "implement"], true),
		},
		{ relation: "relates", words: ["related to"] },
	],
};

const linearWords: LinkWords = {
	refs: linearRefs,
	lists: true,
	tables: [
		{
			relation: "closes",
			words: [
				...forms(["close", "fix", "resolve", "complete", "implement"], true),
				"linear issue",
			],
		},
		{
			relation: "contributes",
			words: [
				"ref",
				"refs",
				"references",
				"part of",
				"contributes to",
				"toward",
				"towards",
			],
		},
		{ relation: "relates", words: ["relates to", "related to"] },
	],
};

export const linkWords: Record<TrackerKind, LinkWords> = {
	github: forgeWords,
	linear: linearWords,
	gitlab: gitlabWords,
	forgejo: forgeWords,
};

type LinkRule = {
	relation: LinkRelation;
	refs: RefSyntax;
	/** Matches a link word, an optional colon and a list of refs. The list is capture group 1. */
	pattern: RegExp;
};

function alternation(words: string[]): string {
	return [...words]
		.sort((left, right) => right.length - left.length)
		.map((word) => word.replace(/ /g, String.raw`\s+`))
		.join("|");
}

function compile(words: LinkWords): LinkRule[] {
	const ref = `(?:${words.refs.source})`;
	const list = words.lists
		? String.raw`${ref}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)${ref})*`
		: ref;
	return words.tables.map(({ relation, words: table }) => ({
		relation,
		refs: words.refs,
		pattern: new RegExp(
			String.raw`\b(?:${alternation(table)})\b:?\s*(${list})\b`,
			"gi",
		),
	}));
}

const rulesOf: Record<TrackerKind, LinkRule[]> = {
	github: compile(linkWords.github),
	linear: compile(linkWords.linear),
	gitlab: compile(linkWords.gitlab),
	forgejo: compile(linkWords.forgejo),
};

type LinkHit = { key: string; relation: LinkRelation; at: number };

/** Every link of a body, in body order, read with the words and ref syntax of `tracker`. */
function linkHits(body: string, repo: string, tracker: TrackerKind): LinkHit[] {
	return rulesOf[tracker]
		.flatMap((rule) =>
			[...body.matchAll(rule.pattern)].flatMap((match) =>
				rule.refs.keysIn(match[1] ?? "", repo).map((key) => ({
					key,
					relation: rule.relation,
					at: match.index,
				})),
			),
		)
		.sort((left, right) => left.at - right.at);
}

/**
 * The relations that a PR body states for each key of a `tracker` ticket, keyed by
 * the folded key in body order. A bare `#number` takes `repo`.
 */
export function bodyLinks(
	body: string,
	repo: string,
	tracker: TrackerKind,
): Map<string, Set<LinkRelation>> {
	const links = new Map<string, Set<LinkRelation>>();
	for (const { key, relation } of linkHits(body, repo, tracker)) {
		const folded = foldKey(key);
		const relations = links.get(folded) ?? new Set<LinkRelation>();
		relations.add(relation);
		links.set(folded, relations);
	}
	return links;
}
