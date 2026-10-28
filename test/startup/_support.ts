import type { Fetch } from "../../src/fetch.ts";
import { urlOf } from "../support/fetch.ts";
import { recordedDiscovery, unrecorded } from "../support/github.ts";
import { repoReadResponse } from "../support/repo-read.ts";

export const valid = JSON.stringify({
	pinned: [{ tracker: "github", repo: "acme/widget" }],
});

export function recordedFetch(userStatus: number): Fetch {
	return async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ message: "recorded" }), {
				status: userStatus,
			});
		}
		if (
			url.includes("/issues?") ||
			url.includes("/pulls?") ||
			url.includes("/branches?") ||
			url.includes("/labels?") ||
			url.includes("/check-runs") ||
			url.includes("/comments") ||
			url.includes("/reviews") ||
			url.includes("/reactions") ||
			/\/pulls\/\d+$/.test(url)
		) {
			return new Response(
				url.includes("/check-runs") ? '{"check_runs":[]}' : "[]",
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}
		if (url === "https://api.github.com/graphql") {
			const read = repoReadResponse(input, init);
			if (read !== null) {
				return read;
			}
			return new Response(
				JSON.stringify({
					data: {
						repository: {
							pullRequest: { closingIssuesReferences: { nodes: [] } },
						},
					},
				}),
				{ status: 200 },
			);
		}
		if (url === "https://api.linear.app/graphql") {
			return new Response(JSON.stringify({ data: { viewer: { id: "lev" } } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return unrecorded(input);
	};
}
