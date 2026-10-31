import type { TicketRef } from "./domain.ts";
import { numberedKey } from "./ticket-key.ts";

const urlShape =
	/^https?:\/\/(?!github\.com\/)[^/\s]+\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)$/i;
const keyShape = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const sameRepoShape = /^#(\d+)$/;

function forgejoRef(project: string, number: string): TicketRef {
	return { tracker: "forgejo", project, key: numberedKey(project, number) };
}

/** The ticket that an issue URL off github.com, a repo key or a bare `#number` in `repo` names. */
export function forgejoTicketRef(
	token: string,
	repo: string | null,
): TicketRef | null {
	const named = token.match(urlShape) ?? token.match(keyShape);
	if (named?.[1] !== undefined && named[2] !== undefined) {
		return forgejoRef(named[1], named[2]);
	}
	const bareNumber = token.match(sameRepoShape)?.[1];
	return bareNumber === undefined || repo === null
		? null
		: forgejoRef(repo, bareNumber);
}
