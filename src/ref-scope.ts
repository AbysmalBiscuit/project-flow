import type { TrackerKind } from "./domain.ts";
import { foldKey } from "./ticket-key.ts";

/**
 * What a ticket's text is read against: its repo, and the tracker of each
 * tracked repo. GitHub and GitLab share the `repo#number` key form.
 */
export type RefScope = {
	/** The repo of the ticket whose text names the ref. A bare `#number` names a ticket of it. */
	repo: string | null;
	/** The tracker of a tracked repo, or undefined for a repo that no project tracks. */
	trackerOfRepo: (repo: string) => TrackerKind | undefined;
};

/** The scope of the tickets of each repo among the tracked repos. */
export function repoScopes(
	repos: readonly { repo: string | null; tracker: TrackerKind }[],
): (repo: string | null) => RefScope {
	const trackers = new Map(
		repos.flatMap((item) =>
			item.repo === null ? [] : [[foldKey(item.repo), item.tracker] as const],
		),
	);
	const trackerOfRepo = (named: string) => trackers.get(foldKey(named));
	return (repo) => ({ repo, trackerOfRepo });
}

const keyShape = /^([^\s#]+)#(\d+)$/;
const bareShape = /^#(\d+)$/;

/** A `repo#number` key, or a bare `#number` of the scope's repo, with the tracker of its repo. */
export function numberedRef(
	token: string,
	scope: RefScope,
): { repo: string; number: string; tracker: TrackerKind | undefined } | null {
	const keyed = token.match(keyShape);
	const repo = keyed?.[1] ?? scope.repo;
	const number = keyed?.[2] ?? token.match(bareShape)?.[1];
	return repo === null || number === undefined
		? null
		: { repo, number, tracker: scope.trackerOfRepo(repo) };
}
