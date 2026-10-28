import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import {
	emptyProjectFields,
	page,
	recordedDiscovery,
	unrecorded,
} from "../support/github.ts";
import { repoReadFromLists } from "../support/repo-read.ts";

export const repo = "AbysmalBiscuit/devkit";

export function issue(
	number: number,
	body: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: state === "closed" ? "completed" : null,
		updated_at: "2026-04-01T00:00:00Z",
		html_url: `https://github.com/${repo}/issues/${number}`,
		body,
		comments_url: `https://api.github.com/repos/${repo}/issues/${number}/comments`,
	};
}

const recorded = [
	issue(404, ""),
	issue(405, ""),
	issue(188, ""),
	issue(220, ""),
	issue(408, ""),
	issue(409, ""),
	issue(410, ""),
	issue(411, ""),
	issue(412, ""),
	issue(600, "Closed.", "closed"),
	issue(
		420,
		"Blocked by: https://github.com/AbysmalBiscuit/devkit/issues/404, https://github.com/AbysmalBiscuit/devkit/issues/405",
	),
	issue(421, "Blocked by: #188"),
	issue(422, "Blocked by: #188, #220"),
	issue(423, "Blocked by: #188."),
	issue(424, "Blocked by: none"),
	issue(425, "Blocked by: none."),
	issue(426, "Blocks: #408"),
	issue(427, "Blocking: #409"),
	issue(428, "**Blocked by:** #410"),
	issue(429, "- Blocked by: #411"),
	issue(430, "blocked by #412"),
	issue(431, "The body has no blocker line."),
	issue(432, "Blocked by: #600"),
	issue(433, "Blocked by:   "),
	issue(434, "Blocked by: #188,  #220"),
	issue(435, ""),
];

export function recordedFetch(): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const listed = repoReadFromLists(input, init, { [repo]: recorded });
		if (listed !== null) {
			return listed;
		}
		const list = `https://api.github.com/repos/${repo}/issues?`;
		if (url.startsWith(list) && url.includes("state=all")) {
			return page(recorded);
		}
		if (
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?")
		) {
			return page([]);
		}
		const comments = url.match(/\/issues\/(\d+)\/comments$/);
		if (comments?.[1] !== undefined) {
			const number = Number(comments[1]);
			if (number === 424 || number === 431) {
				return page([
					{
						id: number,
						body: "Blocked by: #188",
						html_url: `${url}#issuecomment-1`,
					},
				]);
			}
			return page([]);
		}
		return emptyProjectFields(input, init ?? undefined) ?? unrecorded(input);
	};
}

export function blockersOf(
	tickets: { key: string; state: string; blockers: string[] }[],
	key: string,
): { state: string; blockers: string[] } {
	const ticket = tickets.find((item) => item.key === key);
	if (ticket === undefined) {
		throw new Error(`missing ticket ${key}`);
	}
	return { state: ticket.state, blockers: ticket.blockers };
}

export const linearProject = "widget-launch";

export function linearIssue(
	identifier: string,
	description: string,
	stateType = "unstarted",
): Record<string, unknown> {
	return {
		id: identifier,
		identifier,
		title: `Linear ${identifier}`,
		description,
		updatedAt: "2026-04-01T00:00:00.000Z",
		state: { type: stateType },
		inverseRelations: { nodes: [] },
	};
}
