import { z } from "zod";
import type { PullRequest, Ticket } from "./domain.ts";
import type { Fetch } from "./fetch.ts";
import type { Tracker } from "./ports.ts";

const githubIssue = z.object({
	number: z.number(),
	state: z.string(),
	state_reason: z.string().nullable(),
	pull_request: z.unknown().optional(),
});

const githubPull = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	draft: z.boolean().optional(),
	body: z.string().nullable(),
	head: z.object({ ref: z.string() }),
	state: z.string(),
});

const linkedDevelopment = z.object({
	data: z.object({
		repository: z.object({
			pullRequest: z
				.object({
					closingIssuesReferences: z.object({
						nodes: z.array(z.object({ number: z.number() })),
					}),
				})
				.nullable(),
		}),
	}),
});

const developmentQuery = `query LinkedDevelopment($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			closingIssuesReferences(first: 10, userLinkedOnly: true) {
				nodes { number }
			}
		}
	}
}`;

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

async function pages(
	start: string,
	token: string,
	fetchImpl: Fetch,
	repo: string,
	label: string,
): Promise<{ page: unknown; link: string | null }[]> {
	const pages: { page: unknown; link: string | null }[] = [];
	let url: string | null = start;
	while (url !== null) {
		const response = await fetchImpl(url, {
			headers: githubHeaders(token),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub ${label} failed (HTTP ${response.status}): ${repo}`,
			);
		}
		pages.push({
			page: await response.json(),
			link: response.headers.get("link"),
		});
		url = nextPage(response.headers.get("link"));
	}
	return pages;
}

export function githubTracker(token: string, fetchImpl: Fetch): Tracker {
	return {
		async listTickets(repo) {
			const tickets: Ticket[] = [];
			const listed = await pages(
				`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=1`,
				token,
				fetchImpl,
				repo,
				"list tickets",
			);
			for (const item of listed) {
				const page = githubIssuePage.parse(item.page);
				for (const issue of page) {
					if (issue.pull_request !== undefined) {
						continue;
					}
					if (issue.state !== "open" && issue.state !== "closed") {
						continue;
					}
					tickets.push({
						tracker: "github",
						key: `${repo}#${issue.number}`,
						state: issue.state,
						stateReason: issue.state_reason,
					});
				}
			}
			return tickets;
		},
		async listPulls(repo) {
			const pulls: PullRequest[] = [];
			const listed = await pages(
				`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100&page=1`,
				token,
				fetchImpl,
				repo,
				"list pulls",
			);
			for (const item of listed) {
				const page = z.array(githubPull).parse(item.page);
				for (const pull of page) {
					if (pull.state !== "open") {
						continue;
					}
					const body = pull.body ?? "";
					const [owner, name] = repo.split("/");
					const keys: string[] = [];
					if (owner !== undefined && name !== undefined) {
						const response = await fetchImpl("https://api.github.com/graphql", {
							method: "POST",
							headers: githubHeaders(token),
							body: JSON.stringify({
								query: developmentQuery,
								variables: { owner, name, number: pull.number },
							}),
						});
						if (response.ok) {
							const linked = linkedDevelopment.parse(await response.json());
							for (const node of linked.data.repository.pullRequest
								?.closingIssuesReferences.nodes ?? []) {
								const key = `${repo}#${node.number}`;
								if (!keys.includes(key)) {
									keys.push(key);
								}
							}
						}
					}
					pulls.push({
						number: pull.number,
						url: pull.html_url,
						title: pull.title,
						draft: pull.draft === true,
						branch: pull.head.ref,
						body,
						closingKeys: keys,
					});
				}
			}
			return pulls;
		},
		async listBranches(repo) {
			const names: string[] = [];
			const listed = await pages(
				`https://api.github.com/repos/${repo}/branches?per_page=100&page=1`,
				token,
				fetchImpl,
				repo,
				"list branches",
			);
			const branch = z.object({ name: z.string() });
			for (const item of listed) {
				for (const row of z.array(branch).parse(item.page)) {
					names.push(row.name);
				}
			}
			return names;
		},
	};
}
