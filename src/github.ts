import { z } from "zod";
import type { Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { Tracker } from "./ports.ts";

const githubIssue = z.object({
	state: z.string(),
	state_reason: z.string().nullable(),
	pull_request: z.unknown().optional(),
});

const githubIssuePage = z.array(githubIssue);

export function githubHeaders(token: string): HeadersInit {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"x-github-api-version": "2022-11-28",
	};
}

function nextPage(link: string | null): string | null {
	if (link === null) {
		return null;
	}
	for (const part of link.split(",")) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match?.[1] !== undefined) {
			return match[1];
		}
	}
	return null;
}

export async function checkToken(
	token: string,
	fetchImpl: Fetch,
): Promise<Response> {
	return fetchImpl("https://api.github.com/user", {
		headers: githubHeaders(token),
	});
}

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	return {
		async listTickets(repo) {
			const tickets: Ticket[] = [];
			let url: string | null =
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
			while (url !== null) {
				const response = await fetchImpl(url, {
					headers: githubHeaders(token),
				});
				if (!response.ok) {
					throw new Error(
						`GitHub list tickets failed (HTTP ${response.status}): ${repo}`,
					);
				}
				const page = githubIssuePage.parse(await response.json());
				for (const issue of page) {
					if (issue.pull_request !== undefined) {
						continue;
					}
					if (issue.state !== "open" && issue.state !== "closed") {
						continue;
					}
					tickets.push({
						tracker: "github",
						state: issue.state,
						stateReason: issue.state_reason,
					});
				}
				url = nextPage(response.headers.get("link"));
			}
			return tickets;
		},
	};
}
