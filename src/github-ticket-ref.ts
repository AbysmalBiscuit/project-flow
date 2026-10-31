import type { TicketRef } from "./domain.ts";
import { numberedKey } from "./ticket-key.ts";

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
			key: numberedKey(named[1], named[2]),
		};
	}
	const bareNumber = token.match(sameRepoShape)?.[1];
	if (bareNumber === undefined || repo === null) {
		return null;
	}
	return {
		tracker: "github",
		project: repo,
		key: numberedKey(repo, bareNumber),
	};
}
