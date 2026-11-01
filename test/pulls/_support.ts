import type { TicketView } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import recordedPulls from "../fixtures/github-open-pulls.json";
import recordedRefusal from "../fixtures/github-pull-merge-refused.json";
import recordedMerge from "../fixtures/github-pull-merge.json";
import recordedTeam from "../fixtures/linear-team-states.json";
import outsideRelations from "../fixtures/outside-relations.json";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { repoReadFromLists } from "../support/repo-read.ts";

export const repo = "acme/widget";

export const pullUrl = `https://github.com/${repo}/pull/40`;

export const passedCheck = {
	name: "ci",
	status: "completed",
	conclusion: "success",
};

/** The one open PR of the fake: PR 40, which closes ticket 8. */
function openPull(
	body: string,
	branch: string,
	checkRows: unknown[],
	statusRows: unknown[],
) {
	return {
		number: 40,
		title: "Ship the widget",
		state: "open",
		html_url: pullUrl,
		head: { ref: branch, sha: "sha-40" },
		base: { ref: "main" },
		body,
		merged_at: null as string | null,
		checkRows,
		statusRows,
	};
}

type SentMerge = {
	url: string;
	method: string;
	authorization: string | null;
	body: unknown;
};

/**
 * Recorded GitHub answers for `acme/widget`. A merge request merges PR 40,
 * or else gets the recorded refusal when `refuses` is true.
 */
export function mergeFake({
	body = "Closes #8",
	branch = "8-ship",
	checks = [passedCheck],
	statuses = [],
	refuses = false,
}: {
	body?: string;
	branch?: string;
	checks?: unknown[];
	statuses?: CommitStatus[];
	refuses?: boolean;
} = {}): { fetch: Fetch; merges: SentMerge[]; repoReads: () => number } {
	const merges: SentMerge[] = [];
	const pull = openPull(body, branch, checks, statuses);
	let repoReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		if ((init?.method ?? "GET").toUpperCase() === "PUT") {
			merges.push({
				url,
				method: "PUT",
				authorization: new Headers(init?.headers).get("authorization"),
				body: JSON.parse(String(init?.body)),
			});
			if (refuses) {
				return Response.json(recordedRefusal, { status: 405 });
			}
			pull.merged_at = "2026-10-18T12:00:00.000Z";
			pull.state = "closed";
			return Response.json(recordedMerge);
		}
		const read = repoReadFromLists(
			input,
			init,
			{
				[repo]: [
					{
						number: 8,
						title: "Ship the widget",
						state: "open",
						updated_at: "2026-10-01T00:00:00Z",
						body: "",
						labels: [],
					},
				],
			},
			{ [repo]: [pull] },
		);
		if (read !== null) {
			repoReads += 1;
			return read;
		}
		if (url === "https://api.github.com/graphql") {
			return Response.json({ data: {} });
		}
		if (url.includes(`/repos/${repo}/`)) {
			return page([]);
		}
		return unrecorded(input, init);
	};
	return { fetch: fetchImpl, merges, repoReads: () => repoReads };
}

export const widgetConfig = JSON.stringify({
	pinned: [{ tracker: "github", repo }],
	pmBot: { [repo]: false },
});

export const githubEnv = { GITHUB_TOKEN: "recorded-token" };

export function sendMerge(base: string, url = pullUrl): Promise<Response> {
	return fetch(new URL("/api/pulls/merge", base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url }),
	});
}

export async function readTicket(
	base: string,
	project: string,
	key: string,
): Promise<TicketView | undefined> {
	const response = await fetch(
		new URL(`/api/projects/${encodeURIComponent(project)}?view=all`, base),
	);
	const report = (await response.json()) as { tickets: TicketView[] };
	return report.tickets.find((ticket) => ticket.key === key);
}

/** A commit status as GitHub lists it. */
export type CommitStatus = { context: string; state: string };

export const linearConfig = JSON.stringify({
	pinned: [{ tracker: "linear", project: "widget-launch-0d42ae5d46d0" }],
});

export const linearEnv = {
	GITHUB_TOKEN: "recorded-token",
	LINEAR_API_KEY: "recorded-linear-key",
};

/** Recorded answers for a Linear ticket with no PR, whose status is Ready to merge. */
export function linearStatusOnlyFake() {
	const ready = {
		id: "st-merge",
		name: "Ready to merge",
		type: "started",
		color: "#4CB782",
	};
	return linearFake({
		states: [
			...recordedTeam.data.team.states.nodes,
			{ ...ready, position: 2037 },
		],
		issues: [
			{
				...outsideRelations.linearSwe13029,
				id: "swe-13029",
				state: ready,
				attachments: { nodes: [] },
			},
		],
	});
}

/**
 * Recorded answers for a Linear ticket whose attachment names recorded PR 206.
 * The forge reads this PR over REST. Each entry of `checkPages` is one page
 * of check runs.
 */
export function linearMergeFake({
	checkPages = [[]],
	statuses = [],
}: { checkPages?: unknown[][]; statuses?: CommitStatus[] } = {}) {
	const pull = recordedPulls.find((item) => item.number === 206);
	if (pull === undefined) {
		throw new Error("the recorded PR list has no PR 206");
	}
	const pullRepo = "AbysmalBiscuit/project-flow";
	const served: Record<string, unknown> = { ...pull };
	const linear = linearFake({
		states: recordedTeam.data.team.states.nodes,
		issues: [
			{
				...outsideRelations.linearSwe13029,
				id: "swe-13029",
				attachments: {
					nodes: [
						{ url: pull.html_url, title: pull.title, sourceType: "github" },
					],
				},
			},
		],
	});
	const merges: { url: string; body: unknown }[] = [];
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.linear.app/graphql") {
			return linear(input, init);
		}
		if (url === "https://api.github.com/user") {
			return Response.json({ login: "lev" });
		}
		const pullApi = `https://api.github.com/repos/${pullRepo}/pulls/206`;
		if (url === `${pullApi}/merge` && init?.method === "PUT") {
			merges.push({ url, body: JSON.parse(String(init.body)) });
			served.merged_at = "2026-10-18T12:00:00.000Z";
			served.state = "closed";
			return Response.json(recordedMerge);
		}
		if (url === pullApi) {
			return Response.json(served);
		}
		if (url === "https://api.github.com/graphql") {
			return Response.json({ data: {} });
		}
		if (url.includes("/check-runs")) {
			const number = Number(new URL(url).searchParams.get("page") ?? "1");
			return Response.json(
				{ check_runs: checkPages[number - 1] ?? [] },
				number < checkPages.length
					? {
							headers: {
								link: `<${url.split("&page=")[0]}&page=${number + 1}>; rel="next"`,
							},
						}
					: {},
			);
		}
		if (url.includes("/status?")) {
			return Response.json({ statuses });
		}
		if (url.includes(`/repos/${pullRepo}/`)) {
			return Response.json([]);
		}
		return unrecorded(input, init);
	};
	return {
		fetch: fetchImpl,
		merges,
		pull: { ...pull, repo: pullRepo },
	};
}
