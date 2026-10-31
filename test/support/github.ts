import { urlOf } from "./fetch.ts";
import {
	githubIssueNode,
	repoReadIssues,
	repoReadResponse,
} from "./repo-read.ts";

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

export function recordedDiscovery(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		(body.includes("ViewerProjects") || body.includes("OrgProjects"))
	) {
		return new Response(
			JSON.stringify({
				data: {
					viewer: {
						login: "lev",
						projectsV2: emptyPage,
						organizations: emptyPage,
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	if (
		url === "https://api.linear.app/graphql" &&
		body.includes("MemberProjects")
	) {
		return new Response(
			JSON.stringify({
				data: { viewer: { id: "lev" }, projects: emptyPage },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	return null;
}

export function recordedViewer(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const discovered = recordedDiscovery(input, init);
	if (discovered !== null) {
		return discovered;
	}
	if (urlOf(input) === "https://api.github.com/user") {
		return Response.json({ login: "lev" });
	}
	return null;
}

/** The `since` of a GitHub repo read: five minutes before the last good poll. */
export function githubSince(lastPoll: string): string {
	return new Date(Date.parse(lastPoll) - 5 * 60 * 1000).toISOString();
}

export function unrecorded(
	input: string | URL | Request,
	init?: RequestInit,
): Response {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		url === "https://api.github.com/graphql" &&
		body.includes("query RepoRead")
	) {
		return new Response("query RepoRead has no repository body", {
			status: 404,
		});
	}
	const read = repoReadResponse(input, init);
	if (read !== null) {
		return read;
	}
	if (
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/labels\?/.test(url) ||
		/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues\/comments\?/.test(
			url,
		)
	) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	return (
		recordedDiscovery(input) ?? new Response("not recorded", { status: 404 })
	);
}

export function emptyProjectFields(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (urlOf(input) !== "https://api.github.com/graphql") {
		return null;
	}
	if (!body.includes("ProjectFields")) {
		return null;
	}
	return new Response(
		JSON.stringify({
			data: { node: { fields: { nodes: [{}] } } },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export const repo = "acme/widget";

/** The login of the Codex review bot. */
export const codex = "chatgpt-codex-connector[bot]";
export const otherRepo = "acme/other";

export function ticket(
	number: number,
	updatedAt: string,
	state: "open" | "closed" = "open",
): Record<string, unknown> {
	return {
		number,
		title: `Ticket ${number}`,
		state,
		state_reason: null,
		updated_at: updatedAt,
		html_url: `https://github.com/${repo}/issues/${number}`,
	};
}

export function page(
	items: unknown,
	next: string | null = null,
	extra?: Record<string, string>,
): Response {
	const headers = new Headers({ "content-type": "application/json" });
	if (next !== null) {
		headers.set("link", `<${next}>; rel="next"`);
	}
	for (const [name, value] of Object.entries(extra ?? {})) {
		headers.set(name, value);
	}
	return new Response(JSON.stringify(items), { status: 200, headers });
}

export function recordedOrEmpty(url: string): Response | null {
	if (
		url.includes("/pulls?") ||
		url.includes("/branches?") ||
		url.includes("/labels?") ||
		url.includes("/comments") ||
		url.includes("/reviews") ||
		url.includes("/reactions")
	) {
		return page([]);
	}
	if (url.includes("/check-runs")) {
		return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
	}
	return null;
}

export type ListedRead = {
	url: string;
	since: string | null;
	repo: string;
	poll: string;
};

export function listedRead(
	input: string | URL | Request,
	init?: RequestInit,
): ListedRead | null {
	const body = typeof init?.body === "string" ? init.body : "";
	if (
		urlOf(input) !== "https://api.github.com/graphql" ||
		!body.includes("query RepoRead")
	) {
		return null;
	}
	const parsed = JSON.parse(body) as {
		variables?: { owner?: string; name?: string; since?: string | null };
	};
	const owner = parsed.variables?.owner ?? "";
	const name = parsed.variables?.name ?? "";
	const since = parsed.variables?.since ?? null;
	const omitted = since === null || since === "";
	return {
		url: omitted
			? `https://api.github.com/repos/${owner}/${name}/issues`
			: `https://api.github.com/repos/${owner}/${name}/issues?since=${since}`,
		since: omitted ? null : String(since),
		repo: `${owner}/${name}`,
		poll: `${owner}/${name}\0${since ?? ""}`,
	};
}

export function listUrl(url: string, name = repo): URL | null {
	const parsed = new URL(url);
	if (parsed.origin !== "https://api.github.com") {
		return null;
	}
	if (parsed.pathname !== `/repos/${name}/issues`) {
		return null;
	}
	return parsed;
}

export function issuesResponse(
	input: string | URL | Request,
	init: RequestInit | undefined,
	issues: Record<string, unknown>[],
	name = repo,
	pulls: Record<string, unknown>[] = [],
	mergedPulls: Record<string, unknown>[] = [],
): Response | null {
	const listed = listedRead(input, init);
	if (listed === null || listed.repo !== name) {
		return null;
	}
	const since = listed.since ?? "";
	const sinceDay = since.slice(0, 10);
	const nodes = issues
		.filter((item) => {
			const updated = String(item.updated_at ?? item.updatedAt ?? "");
			return (
				since === "" || updated >= since || updated.slice(0, 10) >= sinceDay
			);
		})
		.map((item) => githubIssueNode(item));
	return new Response(
		JSON.stringify(
			repoReadIssues(
				listed.repo.split("/")[0] ?? "acme",
				listed.repo.split("/")[1] ?? "widget",
				nodes,
				{ pulls, mergedPulls },
			),
		),
		{
			status: 200,
			headers: {
				"content-type": "application/json",
				"x-listed-url": listed.url,
			},
		},
	);
}

export const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export function pull(
	number: number,
	ticket = 8,
	sha = head,
	draft = false,
): Record<string, unknown> {
	return {
		number,
		title: `PR ${number}`,
		state: "open",
		draft,
		html_url: `https://github.com/${repo}/pull/${number}`,
		head: { ref: `${number}-feat-review`, sha },
		body: `Closes #${ticket}`,
		merged_at: null,
	};
}
