import type { Fetch } from "../../src/fetch.ts";
import recordedRefusal from "../fixtures/github-pull-merge-refused.json";
import recordedMerge from "../fixtures/github-pull-merge.json";
import { urlOf } from "../support/fetch.ts";
import { page, recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadFromLists } from "../support/repo-read.ts";

export const repo = "acme/widget";

export const pullUrl = `https://github.com/${repo}/pull/40`;

export const passedCheck = {
	name: "ci",
	status: "completed",
	conclusion: "success",
};

/** The one open PR of the fake: PR 40, which closes ticket 8. */
function openPull(body: string, checkRows: unknown[]) {
	return {
		number: 40,
		title: "Ship the widget",
		state: "open",
		html_url: pullUrl,
		head: { ref: "8-ship", sha: "sha-40" },
		base: { ref: "main" },
		body,
		merged_at: null as string | null,
		checkRows,
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
	checks = [passedCheck],
	refuses = false,
}: {
	body?: string;
	checks?: unknown[];
	refuses?: boolean;
} = {}): { fetch: Fetch; merges: SentMerge[]; repoReads: () => number } {
	const merges: SentMerge[] = [];
	const pull = openPull(body, checks);
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
