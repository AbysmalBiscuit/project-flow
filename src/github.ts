import type { Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { Tracker } from "./ports.ts";

type GitHubIssue = {
	state: string;
	state_reason: string | null;
	pull_request?: unknown;
};

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

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	return {
		async listTickets(repo) {
			const tickets: Ticket[] = [];
			let url: string | null =
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`;
			while (url !== null) {
				const response = await fetchImpl(url, {
					headers: {
						accept: "application/vnd.github+json",
						authorization: `Bearer ${token}`,
						"x-github-api-version": "2022-11-28",
					},
				});
				if (!response.ok) {
					throw new Error(
						`GitHub list tickets failed (HTTP ${response.status}): ${repo}`,
					);
				}
				const page = (await response.json()) as GitHubIssue[];
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
