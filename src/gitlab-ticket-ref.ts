import type { TicketRef } from "./domain.ts";
import { gitlabHost } from "./gitlab-pin.ts";
import { numberedRef, type RefScope } from "./ref-scope.ts";
import { numberedKey } from "./ticket-key.ts";

/** The page of an issue or work item on gitlab.com. */
const urlShape = new RegExp(
	`^https://${gitlabHost.replaceAll(".", "\\.")}/([^\\s#?]+?)/-/(?:issues|work_items)/(\\d+)$`,
	"i",
);

function gitlabRef(repo: string, number: string): TicketRef {
	return { tracker: "gitlab", project: repo, key: numberedKey(repo, number) };
}

/** The ticket that a GitLab URL, or a key or bare `#number` of a tracked GitLab repo, names. */
export function gitlabTicketRef(
	token: string,
	scope: RefScope,
): TicketRef | null {
	const url = token.match(urlShape);
	if (url?.[1] !== undefined && url[2] !== undefined) {
		return gitlabRef(url[1], url[2]);
	}
	const numbered = numberedRef(token, scope);
	return numbered?.tracker === "gitlab"
		? gitlabRef(numbered.repo, numbered.number)
		: null;
}
