import type { TicketRef } from "./domain.ts";

const urlShape =
	/^https?:\/\/linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]+-\d+)(?:\/[^\s)]*)?$/i;
const keyShape = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

/** The ticket that a Linear URL or a Linear key names. */
export function linearTicketRef(token: string): TicketRef | null {
	const key = token.match(urlShape)?.[1] ?? token.match(keyShape)?.[0];
	return key === undefined
		? null
		: { tracker: "linear", project: "", key: key.toUpperCase() };
}
