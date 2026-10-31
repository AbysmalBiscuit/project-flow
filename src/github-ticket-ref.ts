import type { TicketRef } from "./domain.ts";
import { githubKey, githubKeyParts } from "./ticket-key.ts";

const urlShape =
	/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(?:issues|pull)\/(\d+)$/i;
const keyShape = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const sameRepoShape = /^#(\d+)$/;

/** The ticket that a GitHub URL, a GitHub key or a bare `#number` in `repo` names. */
export function githubTicketRef(
	token: string,
	repo: string | null,
): TicketRef | null {
	const named = token.match(urlShape) ?? token.match(keyShape);
	if (named?.[1] !== undefined && named[2] !== undefined) {
		return {
			tracker: "github",
			project: named[1],
			key: githubKey(named[1], named[2]),
		};
	}
	const bareNumber = token.match(sameRepoShape)?.[1];
	if (bareNumber === undefined || repo === null) {
		return null;
	}
	return {
		tracker: "github",
		project: repo,
		key: githubKey(repo, bareNumber),
	};
}

/** The web page of the GitHub ticket with `key`, or undefined for a key of another shape. */
export function githubTicketUrl(key: string): string | undefined {
	const parts = githubKeyParts(key);
	return parts === null
		? undefined
		: `https://github.com/${parts.repo}/issues/${parts.number}`;
}
