import type { TicketRef } from "./domain.ts";
import { numberedRef, type RefScope } from "./ref-scope.ts";
import { numberedKey } from "./ticket-key.ts";

const urlShape =
	/^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(?:issues|pull)\/(\d+)$/i;
const repoShape = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function githubRef(repo: string, number: string): TicketRef {
	return { tracker: "github", project: repo, key: numberedKey(repo, number) };
}

/**
 * The ticket that a GitHub URL, a GitHub key or a bare `#number` names. A key
 * of a repo that another tracker reads is not a GitHub key.
 */
export function githubTicketRef(
	token: string,
	scope: RefScope,
): TicketRef | null {
	const url = token.match(urlShape);
	if (url?.[1] !== undefined && url[2] !== undefined) {
		return githubRef(url[1], url[2]);
	}
	const numbered = numberedRef(token, scope);
	return numbered !== null &&
		repoShape.test(numbered.repo) &&
		(numbered.tracker ?? "github") === "github"
		? githubRef(numbered.repo, numbered.number)
		: null;
}
