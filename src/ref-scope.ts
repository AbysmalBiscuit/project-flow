import type { TrackerKind } from "./domain.ts";
import { foldKey } from "./ticket-key.ts";

/**
 * What a ticket's text is read against: its repo, its tracker, and the
 * trackers of each tracked repo. GitHub and GitLab share the `repo#number`
 * key form, and two trackers can track repos of one path.
 */
export type RefScope = {
	/** The repo of the ticket whose text names the ref. A bare `#number` names a ticket of it. */
	repo: string | null;
	/** The tracker of the ticket whose text names the ref. */
	tracker: TrackerKind;
	/** The trackers that track a repo of this path. */
	trackersOfRepo: (repo: string) => ReadonlySet<TrackerKind>;
};

/** The scope of the tickets of each repo and tracker among the tracked repos. */
export function repoScopes(
	repos: readonly { repo: string | null; tracker: TrackerKind }[],
): (repo: string | null, tracker: TrackerKind) => RefScope {
	const trackers = new Map<string, Set<TrackerKind>>();
	for (const item of repos) {
		if (item.repo !== null) {
			const path = foldKey(item.repo);
			trackers.set(path, (trackers.get(path) ?? new Set()).add(item.tracker));
		}
	}
	const none: ReadonlySet<TrackerKind> = new Set();
	const trackersOfRepo = (named: string) =>
		trackers.get(foldKey(named)) ?? none;
	return (repo, tracker) => ({ repo, tracker, trackersOfRepo });
}

const keyShape = /^([^\s#]+)#(\d+)$/;
const bareShape = /^#(\d+)$/;

/**
 * A `repo#number` key, or a bare `#number` of the scope's repo, with its
 * tracker. A bare number and a key of a repo that the scope's tracker tracks
 * take the scope's tracker. A key of a repo that one other tracker tracks takes
 * that tracker. Any other key has no tracker.
 */
export function numberedRef(
	token: string,
	scope: RefScope,
): { repo: string; number: string; tracker: TrackerKind | undefined } | null {
	const keyed = token.match(keyShape);
	const repo = keyed?.[1] ?? scope.repo;
	const number = keyed?.[2] ?? token.match(bareShape)?.[1];
	if (repo === null || number === undefined) {
		return null;
	}
	if (keyed === null) {
		return { repo, number, tracker: scope.tracker };
	}
	const trackers = scope.trackersOfRepo(repo);
	const [only] = trackers;
	const tracker = trackers.has(scope.tracker)
		? scope.tracker
		: trackers.size === 1
			? only
			: undefined;
	return { repo, number, tracker };
}
