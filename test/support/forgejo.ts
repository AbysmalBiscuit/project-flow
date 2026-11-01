import type { Fetch } from "../../src/fetch.ts";
import branches from "../fixtures/forgejo-branches.json";
import commit10 from "../fixtures/forgejo-commit-10.json";
import commit12 from "../fixtures/forgejo-commit-12.json";
import dependencies5 from "../fixtures/forgejo-issue-5-dependencies.json";
import issues from "../fixtures/forgejo-issues.json";
import openPulls from "../fixtures/forgejo-open-pulls.json";
import reactions10 from "../fixtures/forgejo-pull-10-reactions.json";
import reviews10 from "../fixtures/forgejo-pull-10-reviews.json";
import status10 from "../fixtures/forgejo-pull-10-status.json";
import pull10 from "../fixtures/forgejo-pull-10.json";
import status11 from "../fixtures/forgejo-pull-11-status.json";
import status12 from "../fixtures/forgejo-pull-12-status.json";
import rejectedUser from "../fixtures/forgejo-user-401.json";
import userRepos from "../fixtures/forgejo-user-repos.json";
import { json, urlOf } from "./fetch.ts";
import {
	page,
	recordedDiscovery,
	recordedOrEmpty,
	unrecorded,
} from "./github.ts";
import { linearFake } from "./linear.ts";

export const host = "codeberg.org";
export const tokenEnv = "CODEBERG_TOKEN";
export const hosts = [{ host, forge: "forgejo", tokenEnv }];
export const scratch = "AbysmalBiscuit/project-flow-scratch";
export const repoApi = `https://${host}/api/v1/repos/${scratch}`;

export const env = {
	GITHUB_TOKEN: "recorded-token",
	LINEAR_API_KEY: "recorded-linear-key",
	[tokenEnv]: "recorded-codeberg-token",
};

const statusBySha = new Map(
	[status10, status11, status12].map((status) => [status.sha, status]),
);

export type Sent = { url: string; authorization: string | null };

export type Codeberg = {
	userStatus?: number;
	/** The HTTP status of the repo discovery read, when it fails. */
	reposStatus?: number;
	/** The repos that the discovery read answers, in place of the recorded repos. */
	repos?: unknown[];
	/** Answers that replace the recorded answer of a repo path, by the start of the path. */
	answers?: Record<string, () => Response>;
};

export const rejected = () => json(rejectedUser, 401);

/** The recorded answers of the Codeberg scratch repo, or null for a URL on another host. */
export function codeberg(url: string, options: Codeberg): Response | null {
	if (!url.startsWith(`https://${host}/`)) {
		return null;
	}
	if (url === `https://${host}/api/v1/user`) {
		return options.userStatus === 401
			? rejected()
			: json({ login: "AbysmalBiscuit" });
	}
	if (url.startsWith(`https://${host}/api/v1/user/repos`)) {
		return options.reposStatus === undefined
			? json(options.repos ?? userRepos)
			: json({ message: "discovery failed" }, options.reposStatus);
	}
	const path = url.slice(repoApi.length);
	const answer = Object.entries(options.answers ?? {}).find(([start]) =>
		path.startsWith(start),
	)?.[1];
	if (answer !== undefined) {
		return answer();
	}
	if (path.startsWith("/issues?")) {
		return json(issues);
	}
	if (path.startsWith("/issues/5/dependencies")) {
		return json(dependencies5);
	}
	if (path.startsWith("/issues/10/reactions")) {
		return json(reactions10);
	}
	if (/^\/issues\/\d+\/reactions/.test(path)) {
		return json(null);
	}
	if (path.startsWith(`/git/commits/${commit10.sha}`)) {
		return json(commit10);
	}
	if (path.startsWith(`/git/commits/${commit12.sha}`)) {
		return json(commit12);
	}
	if (path === "/pulls/10") {
		return json(pull10);
	}
	if (path.startsWith("/pulls/10/reviews")) {
		return json(reviews10);
	}
	if (path.startsWith("/pulls?state=open")) {
		return json(openPulls);
	}
	if (path.startsWith("/branches")) {
		return json(branches);
	}
	const sha = path.match(/^\/commits\/([0-9a-f]{40})\/status/)?.[1];
	if (sha !== undefined) {
		return json(statusBySha.get(sha) ?? null, statusBySha.has(sha) ? 200 : 404);
	}
	if (
		path.startsWith("/pulls?state=closed") ||
		/^\/issues\/\d+\/(?:comments|dependencies)/.test(path) ||
		/^\/pulls\/\d+\/reviews/.test(path)
	) {
		return json([]);
	}
	return new Response(`unrecorded: ${url}`, { status: 599 });
}

export function attachedIssue(number: number, url: string) {
	return {
		identifier: `WID-${number}`,
		title: `Linear ticket ${number}`,
		updatedAt: "2026-10-01T00:00:00.000Z",
		state: { type: "unstarted" },
		attachments: {
			nodes: [{ url, title: `Link ${number}`, sourceType: null }],
		},
	};
}

/** Codeberg beside the recorded GitHub and Linear answers. It records each request in `sent`. */
export function linearWithCodeberg(
	sent: Sent[],
	options: Codeberg = {},
	issues = [attachedIssue(8, `https://${host}/${scratch}/pulls/10`)],
): Fetch {
	const linear = linearFake({
		issues,
		github: async (input, init) => {
			const url = urlOf(input);
			if (url === "https://api.github.com/user") {
				return page({ login: "lev" });
			}
			if (url.includes("/repos/acme/widget/issues?")) {
				return page([]);
			}
			return (
				recordedDiscovery(input, init) ??
				recordedOrEmpty(url) ??
				unrecorded(input)
			);
		},
	});
	return async (input, init) => {
		const url = urlOf(input);
		sent.push({
			url,
			authorization: new Headers(init?.headers).get("authorization"),
		});
		return codeberg(url, options) ?? linear(input, init);
	};
}
