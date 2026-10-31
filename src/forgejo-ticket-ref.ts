import type { TicketRef } from "./domain.ts";
import { numberedKey } from "./ticket-key.ts";

const hostedRepoShape = /^([^/\s]+)\/[^/\s]+\/[^/\s]+$/;
const urlShape = /^https?:\/\/([^/\s]+)\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)$/i;
const keyShape = /^(?:([^/\s#]+)\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const sameRepoShape = /^#(\d+)$/;

/**
 * The ticket that an issue URL, a repo key or a bare `#number` names on the
 * host of `repo`. `repo` is the `host/owner/name` form of the repo that holds
 * the text, so a reference to another host or from another tracker names no
 * Forgejo ticket.
 */
export function forgejoTicketRef(
	token: string,
	repo: string | null,
): TicketRef | null {
	const host = repo?.match(hostedRepoShape)?.[1];
	if (repo === null || host === undefined) {
		return null;
	}
	const ref = (project: string, number: string): TicketRef => ({
		tracker: "forgejo",
		project,
		key: numberedKey(project, number),
	});
	const url = token.match(urlShape);
	if (url?.[2] !== undefined && url[3] !== undefined) {
		return url[1]?.toLowerCase() === host
			? ref(`${host}/${url[2]}`, url[3])
			: null;
	}
	const key = token.match(keyShape);
	if (key?.[2] !== undefined && key[3] !== undefined) {
		const named = key[1]?.toLowerCase() ?? host;
		return named === host ? ref(`${host}/${key[2]}`, key[3]) : null;
	}
	const bareNumber = token.match(sameRepoShape)?.[1];
	return bareNumber === undefined ? null : ref(repo, bareNumber);
}
